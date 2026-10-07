import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns } from "../reference";

/**
 * The 2014 Rogue and its Thief (SRD 5.1). Sneak Attack, Cunning Action, Uncanny Dodge, Evasion and Elusive work as their
 * 2024 namesakes do and run the same way; the 2014 rogue has no Steady Aim, Cunning Strike or Weapon Mastery, its
 * Slippery Mind gives only Wisdom saves, and its Stroke of Luck turns a miss into a hit.
 */
const ref = srd14Class("rogue");

export const ROGUE_2014: ClassDefinition = {
  id: "srd:class:rogue-2014",
  name: "Rogue",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 8,
  primaryAbilities: ["dex"],
  // As a multiclass character: one skill from the class's list.
  multiclass: { skills: 1 },
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "hand-crossbow", "longsword", "rapier", "shortsword"],
  armorTraining: ["light"],
  subclassLevel: 3,
  subclassLabel: "Roguish Archetype",
  featLevels: [4, 8, 10, 12, 16, 19],
  table: srd14Columns("rogue"),
  levels: [
    {
      level: 1,
      grants: [
        grant("sneak-attack", runs("rogue_sneak-attack", {
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
        }), { scale: [{ path: "effects.0.damage.0.dice", value: "{col:sneak-attack}" }] }),
        grant("thieves-cant", informational("rogue_thieves-cant"))
      ],
      choices: [choice({ kind: "expertise", id: "expertise", count: 2 }, "rogue_expertise")]
    },
    {
      level: 2,
      grants: [grant("cunning-action", runs("rogue_cunning-action", {
        grantedActions: [
          { kind: "utility", id: "cunning-dash", name: "Cunning Action: Dash", actionType: "bonus", mode: "dash", automationSupport: "full" },
          { kind: "utility", id: "cunning-disengage", name: "Cunning Action: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
          { kind: "utility", id: "cunning-hide", name: "Cunning Action: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }
        ]
      }))]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "rogue_roguish-archetype")] },
    {
      level: 5,
      grants: [grant("uncanny-dodge", runs("rogue_uncanny-dodge", {
        grantedActions: [{
          kind: "activate-feature", id: "uncanny-dodge", name: "Uncanny Dodge", actionType: "reaction", featureId: "",
          reaction: { trigger: { kind: "would-take-damage", attackOnly: true }, target: "self", priority: "worthwhile" },
          damageCut: { kind: "halve" }, automationSupport: "full"
        }]
      }))]
    },
    { level: 6, grants: [], choices: [choice({ kind: "expertise", id: "expertise", count: 2 }, "rogue_expertise")] },
    { level: 7, grants: [grant("evasion", runs("rogue_evasion", { effects: [{ kind: "evasion" }] }))] },
    { level: 11, grants: [grant("reliable-talent", informational("rogue_reliable-talent"))] },
    // Awareness of hidden and invisible creatures within 10 ft: the simulator has no hiding or invisibility.
    { level: 14, grants: [grant("blindsense", informational("rogue_blindsense"))] },
    { level: 15, grants: [grant("slippery-mind", informational("rogue_slippery-mind"), { adjust: { saves: ["wis"] } })] },
    { level: 18, grants: [grant("elusive", runs("rogue_elusive", { effects: [{ kind: "no-advantage-against" }] }))] },
    {
      level: 20,
      // A missed attack turned into a hit (an ability check treated as a 20 is outside a fight), once a rest.
      grants: [grant("stroke-of-luck", runs("rogue_stroke-of-luck", {
        effects: [{ kind: "d20-change", rolls: ["attack"], change: "hit", resourceCost: { resourceId: "stroke-of-luck", amount: 1 } }]
      }), { pool: { id: "stroke-of-luck", size: 1 } })]
    }
  ],
  equipmentLines: [
    {
      id: "melee",
      options: [
        { id: "a", label: "(a) A rapier", items: [{ ref: "srd:weapon:rapier" }] },
        { id: "b", label: "(b) A shortsword", items: [{ ref: "srd:weapon:shortsword" }] }
      ]
    },
    {
      id: "ranged",
      options: [
        { id: "a", label: "(a) A shortbow and a quiver of 20 arrows", items: [{ ref: "srd:weapon:shortbow" }] },
        { id: "b", label: "(b) A shortsword", items: [{ ref: "srd:weapon:shortsword" }] }
      ]
    },
    {
      id: "kit",
      options: [{ id: "a", label: "Leather armor, two daggers and thieves' tools", items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:dagger", count: 2 }] }]
    }
  ],
  suggested: {
    abilities: ["dex", "con", "wis", "int", "cha", "str"],
    tactics: "skirmisher",
    background: "srd:background:acolyte-2014",
    skills: ["stealth", "perception", "acrobatics", "investigation", "deception", "athletics"],
    expertise: ["stealth", "perception", "acrobatics", "investigation"],
    equipmentLines: { melee: "a", ranged: "a", kit: "a" }
  },
  description: "A scoundrel who uses stealth and trickery to overcome obstacles and enemies."
};

export const THIEF_2014: SubclassDefinition = {
  id: "srd:subclass:thief-2014",
  name: "Thief",
  source: srd51Source("srd_thief"),
  edition: "2014",
  classId: "srd:class:rogue-2014",
  levels: [
    {
      level: 3,
      grants: [
        grant("fast-hands", informational("thief_fast-hands")),
        grant("second-story-work", informational("thief_second-story-work"), { adjust: { movementEqualToSpeed: ["climb"] } })
      ]
    },
    { level: 9, grants: [grant("supreme-sneak", informational("thief_supreme-sneak"))] },
    { level: 13, grants: [grant("use-magic-device", informational("thief_use-magic-device"))] },
    { level: 17, grants: [grant("thiefs-reflexes", reference("thief_thiefs-reflexes"))] }
  ]
};
