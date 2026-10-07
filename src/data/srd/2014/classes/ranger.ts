import type { CreatureType } from "@/engine";
import type { ClassDefinition, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Feature, srd14FeatureText, srd14Numbers } from "../reference";

/**
 * The 2014 Ranger and its Hunter (SRD 5.1). It knows its spells (the Spells Known column) from 2nd level, its favored
 * enemies matter in a fight only to Foe Slayer (20th), and it has no Weapon Mastery or Hunter's Mark of its own. The
 * Hunter's options are each chosen at their level; what runs as the 2024 Hunter's does is written the same way.
 */
const ref = srd14Class("ranger");
const spell = srd2014SpellId;

/** The ranger's 2014 fighting styles: four of the six. */
const RANGER_STYLES = ["Archery", "Defense", "Dueling", "Two-Weapon Fighting"];

/** Favored Enemy's types (two humanoid races count as the humanoid type here). */
const FAVORED: CreatureType[] = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];
const plural = (type: string) => {
  const word = type === "fey" || type === "undead" ? type : type === "monstrosity" ? "monstrosities" : `${type}s`;
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
};

/** A favored enemy: tracking and lore outside a fight, and Foe Slayer's Wisdom against it, once a turn, from 20th level. */
const favored = (type: CreatureType): PickOption => ({
  id: type, name: plural(type),
  grants: [
    { key: `favored-enemy-${type}`, feature: informational("ranger_favored-enemy", { name: `Favored Enemy: ${plural(type)}` }) },
    {
      key: `foe-slayer-${type}`, atLevel: 20,
      feature: runs("ranger_foe-slayer", {
        name: `Foe Slayer (${plural(type).toLowerCase()})`,
        effects: [{ kind: "damage-bonus", oncePerTurn: true, targetTypes: [type], attackTypes: ["melee", "ranged"], damage: [{ dice: "1", damageType: "same-as-attack" }] }],
        notSimulated: "its Wisdom goes on the damage here; the rules let it go on the attack roll instead."
      }),
      scale: [{ path: "effects.0.damage.0.dice", value: "0+{mod:wis|min:0}" }]
    }
  ]
});
const favoredEnemy = (label: string) => ({ kind: "pick" as const, id: "favored-enemy", label, count: 1, options: FAVORED.map(favored) });

export const RANGER_SPELLS_2014 = ["cure-wounds", "longstrider", "hunters-mark", "spike-growth", "pass-without-trace", "conjure-animals", "lightning-arrow", "stoneskin", "freedom-of-movement"].map(spell);

export const RANGER_2014: ClassDefinition = {
  id: "srd:class:ranger-2014",
  name: "Ranger",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 10,
  // Multiclassing: Dexterity 13 and Wisdom 13.
  primaryAbilities: ["dex", "wis"],
  // As a multiclass character: one skill from the class's list.
  multiclass: { skills: 1 },
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "shield"],
  spellcasting: { ability: "wis", kind: "half", list: "ranger-2014", prepared: srd14Numbers("ranger", "spells-known"), firstSlotsAt: 2, multiclassRounding: "down" },
  subclassLevel: 3,
  subclassLabel: "Ranger Archetype",
  featLevels: [4, 8, 12, 16, 19],
  table: srd14Columns("ranger"),
  levels: [
    {
      level: 1,
      grants: [
        // Favored terrain: travel and survival, outside a fight.
        grant("natural-explorer", informational("ranger_natural-explorer"))
      ],
      choices: [choice(favoredEnemy("Favored Enemy"), "ranger_favored-enemy")]
    },
    {
      level: 2,
      grants: [grant("spellcasting", runs("ranger_spellcasting"))],
      choices: [choice({ kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Fighting Style", names: RANGER_STYLES }, "ranger_fighting-style")]
    },
    {
      level: 3,
      // Sensing creature types for minutes: outside a fight.
      grants: [grant("primeval-awareness", informational("ranger_primeval-awareness"))],
      choices: [choice({ kind: "subclass", id: "subclass" }, "ranger_ranger-archetype")]
    },
    {
      level: 5,
      grants: [grant("extra-attack", runs("ranger_extra-attack", {
        grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true, attacks: [{ any: "weapon", count: 2 }], automationSupport: "full" }]
      }))]
    },
    { level: 6, grants: [], choices: [favoredEnemy("Favored Enemy (another)")] },
    {
      level: 8,
      grants: [grant("lands-stride", runs("ranger_lands-stride", {
        effects: [{ kind: "ignore-difficult-terrain" }],
        notSimulated: "magical difficult terrain should still cost it extra, and it has advantage on saves against magical plants."
      }))]
    },
    // A minute's camouflage for hiding: the simulator has no stealth.
    { level: 10, grants: [grant("hide-in-plain-sight", informational("ranger_hide-in-plain-sight"))] },
    {
      level: 14,
      grants: [grant("vanish", runs("ranger_vanish", {
        grantedActions: [{ kind: "utility", id: "vanish", name: "Vanish: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }],
        notSimulated: "hiding (the simulator has no stealth), and not being tracked."
      }))],
      choices: [favoredEnemy("Favored Enemy (a third)")]
    },
    // Fighting what it can't see without disadvantage, and knowing where an invisible creature within 30 ft is.
    { level: 18, grants: [grant("feral-senses", informational("ranger_feral-senses"), { adjust: { senses: { blindsight: 30 } } })] }
  ],
  equipmentLines: [
    {
      id: "armor",
      options: [
        { id: "a", label: "(a) Scale mail", items: [{ ref: "srd:item:scale-mail" }] },
        { id: "b", label: "(b) Leather armor", items: [{ ref: "srd:item:leather-armor" }] }
      ]
    },
    {
      id: "melee",
      options: [
        { id: "a", label: "(a) Two shortswords", items: [{ ref: "srd:weapon:shortsword", count: 2 }] },
        { id: "b", label: "(b) Two simple melee weapons", items: [], anyWeapon: { category: "simple", melee: true, count: 2 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "A pack, a longbow and a quiver of 20 arrows", items: [{ ref: "srd:weapon:longbow" }] }] }
  ],
  suggested: {
    abilities: ["dex", "wis", "con", "str", "int", "cha"],
    tactics: "basic-ranged",
    background: "srd:background:acolyte-2014",
    skills: ["perception", "stealth", "survival", "nature"],
    fightingStyle: "srd:feat:archery-2014",
    equipmentLines: { armor: "a", melee: "a", kit: "a" },
    picks: { "favored-enemy": ["undead", "monstrosity", "humanoid", "fiend", "beast", "dragon", "giant"] },
    spells: RANGER_SPELLS_2014
  },
  description: "A warrior who uses martial prowess and nature magic to combat threats on the edges of civilization."
};

/** A Hunter option: its paragraph of the feature's text ("***Colossus Slayer.*** …"), as a feature of its own. */
function hunterOption(key: string, name: string) {
  const text = srd14FeatureText(key);
  const start = text.indexOf(`***${name}.***`);
  const end = text.indexOf("***", start + name.length + 7);
  return { name, text: text.slice(start, end < 0 ? undefined : end).replace(`***${name}.***`, "").trim(), slug: `${srd14Feature(key).key}:${name}` };
}

export const HUNTER_2014: SubclassDefinition = {
  id: "srd:subclass:hunter-2014",
  name: "Hunter",
  source: srd51Source("srd_hunter"),
  edition: "2014",
  classId: "srd:class:ranger-2014",
  levels: [
    {
      level: 3,
      grants: [],
      choices: [choice({
        kind: "pick", id: "hunters-prey", label: "Hunter's Prey", count: 1,
        options: [
          {
            id: "colossus-slayer", name: "Colossus Slayer", description: "1d8 more, once a turn, on a creature below its hit point maximum",
            grants: [{
              key: "hunters-prey",
              feature: runs(hunterOption("hunter_hunters-prey", "Colossus Slayer"), {
                name: "Hunter's Prey: Colossus Slayer",
                effects: [{ kind: "damage-bonus", oncePerTurn: true, condition: "target-injured", attackTypes: ["melee", "ranged"], damage: [{ dice: "1d8", damageType: "same-as-attack" }] }]
              })
            }]
          },
          {
            id: "giant-killer", name: "Giant Killer", description: "A reaction attack on a Large or larger creature next to it that attacks it",
            // Its reaction to a Large or larger attacker within 5 ft, hit or miss: no reaction by an attacker's size yet.
            grants: [{ key: "hunters-prey", feature: reference(hunterOption("hunter_hunters-prey", "Giant Killer"), { name: "Hunter's Prey: Giant Killer" }) }]
          },
          {
            id: "horde-breaker", name: "Horde Breaker", description: "Another attack on a creature next to the first, once a turn",
            grants: [{
              key: "hunters-prey",
              feature: runs(hunterOption("hunter_hunters-prey", "Horde Breaker"), { name: "Hunter's Prey: Horde Breaker", effects: [{ kind: "follow-up-attack", withinFt: 5 }] })
            }]
          }
        ]
      }, "hunter_hunters-prey")]
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
              feature: runs(hunterOption("hunter_defensive-tactics", "Escape the Horde"), { name: "Defensive Tactics: Escape the Horde", effects: [{ kind: "attack-defense", against: "opportunity" }] })
            }]
          },
          {
            id: "multiattack-defense", name: "Multiattack Defense", description: "+4 AC against a creature's later attacks the turn it hits",
            grants: [{
              key: "defensive-tactics",
              feature: runs(hunterOption("hunter_defensive-tactics", "Multiattack Defense"), {
                name: "Defensive Tactics: Multiattack Defense", effects: [{ kind: "attack-defense", against: "after-hit" }],
                notSimulated: "the creature's later attacks that turn have disadvantage here, rather than facing +4 AC."
              })
            }]
          },
          {
            id: "steel-will", name: "Steel Will", description: "Advantage on saves against being frightened",
            grants: [{
              key: "defensive-tactics",
              feature: runs(hunterOption("hunter_defensive-tactics", "Steel Will"), { name: "Defensive Tactics: Steel Will", effects: [{ kind: "save-advantage", against: { conditions: ["frightened"] } }] })
            }]
          }
        ]
      }, "hunter_defensive-tactics")]
    },
    {
      level: 11,
      grants: [],
      choices: [choice({
        kind: "pick", id: "multiattack", label: "Multiattack", count: 1,
        options: (["Volley", "Whirlwind Attack"] as const).map((name) => ({
          id: name.toLowerCase().replace(/ /g, "-"), name,
          description: name === "Volley" ? "A ranged attack against each creature within 10 ft of a point" : "A melee attack against each creature within 5 ft",
          // One attack roll for each creature in an area: not yet.
          grants: [{ key: "multiattack", feature: reference(hunterOption("hunter_multiattack", name), { name: `Multiattack: ${name}` }) }]
        }))
      }, "hunter_multiattack")]
    },
    {
      level: 15,
      grants: [],
      choices: [choice({
        kind: "pick", id: "superior-hunters-defense", label: "Superior Hunter's Defense", count: 1,
        options: [
          {
            id: "evasion", name: "Evasion", description: "No damage on a made Dexterity save, half on a failed one",
            grants: [{ key: "superior-hunters-defense", feature: runs(hunterOption("hunter_superior-hunters-defense", "Evasion"), { name: "Superior Hunter's Defense: Evasion", effects: [{ kind: "evasion" }] }) }]
          },
          {
            id: "stand-against-the-tide", name: "Stand Against the Tide", description: "A missed melee attack made again at another creature",
            // Its reaction: the attacker repeats a missed melee attack against another creature. Not yet.
            grants: [{ key: "superior-hunters-defense", feature: reference(hunterOption("hunter_superior-hunters-defense", "Stand Against the Tide"), { name: "Superior Hunter's Defense: Stand Against the Tide" }) }]
          },
          {
            id: "uncanny-dodge", name: "Uncanny Dodge", description: "Its reaction halves an attack's damage",
            grants: [{
              key: "superior-hunters-defense",
              feature: runs(hunterOption("hunter_superior-hunters-defense", "Uncanny Dodge"), {
                name: "Superior Hunter's Defense: Uncanny Dodge",
                grantedActions: [{
                  kind: "activate-feature", id: "uncanny-dodge", name: "Uncanny Dodge", actionType: "reaction", featureId: "",
                  reaction: { trigger: { kind: "would-take-damage", attackOnly: true }, target: "self", priority: "worthwhile" },
                  damageCut: { kind: "halve" }, automationSupport: "full"
                }]
              })
            }]
          }
        ]
      }, "hunter_superior-hunters-defense")]
    }
  ]
};
