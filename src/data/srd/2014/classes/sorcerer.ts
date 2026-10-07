import type { ActionDefinition, DamageType, FeatureEffect } from "@/engine";
import type { ClassDefinition, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { choice, grant, informational, reference, referenceOptions, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Numbers } from "../reference";

/**
 * The 2014 Sorcerer and its Draconic Bloodline (SRD 5.1). It knows its spells (the Spells Known column) rather than
 * preparing them, has its origin from 1st level, and no Innate Sorcery. Font of Magic's conversions are bonus actions,
 * and any slot up to 5th can be made from points. Its Metamagic options run as the 2024 ones do, Heightened Spell at 3
 * points; Careful, Extended and Twinned Spell differ in ways the engine doesn't yet follow.
 */
const ref = srd14Class("sorcerer");

const SORCERY_POINTS = (amount: number) => ({ resourceId: "sorcery-points", amount });

/** Creating Spell Slots: each slot level and its sorcery point cost. */
const SLOT_COSTS = [{ slot: 1, cost: 2 }, { slot: 2, cost: 3 }, { slot: 3, cost: 5 }, { slot: 4, cost: 6 }, { slot: 5, cost: 7 }];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];

/** Font of Magic: a slot turned into as many points as its level, and a slot made from points, each a bonus action. */
const fontOfMagic = runs("sorcerer_font-of-magic", {
  grantedActions: [
    {
      kind: "activate-feature", id: "font-of-magic-points", name: "Font of Magic: Slot to Sorcery Points", actionType: "bonus", featureId: "",
      resourceCost: { resourceId: "slot-1", amount: 1 }, gains: { resourceId: "sorcery-points", amount: "slot-level", max: 2 },
      automationSupport: "full"
    },
    ...SLOT_COSTS.map((entry): ActionDefinition => ({
      kind: "activate-feature", id: `font-of-magic-slot-${entry.slot}`, name: `Font of Magic: Create a ${ORDINAL[entry.slot]}-Level Slot`,
      actionType: "bonus", featureId: "", resourceCost: SORCERY_POINTS(entry.cost), gains: { resourceId: `slot-${entry.slot}`, amount: 1 },
      automationSupport: "full"
    }))
  ]
});

/** What each 2014 Metamagic option does in a fight. */
const METAMAGIC_EFFECTS: Record<string, FeatureEffect[]> = {
  "careful-spell": [{ kind: "metamagic", option: "careful", resourceCost: SORCERY_POINTS(1) }],
  "distant-spell": [{ kind: "metamagic", option: "distant", resourceCost: SORCERY_POINTS(1) }],
  "empowered-spell": [{ kind: "metamagic", option: "empowered", resourceCost: SORCERY_POINTS(1) }],
  "extended-spell": [{ kind: "metamagic", option: "extended", resourceCost: SORCERY_POINTS(1) }],
  "heightened-spell": [{ kind: "metamagic", option: "heightened", resourceCost: SORCERY_POINTS(3) }],
  "quickened-spell": [{ kind: "metamagic", option: "quickened", resourceCost: SORCERY_POINTS(2) }],
  "subtle-spell": [{ kind: "metamagic", option: "subtle", resourceCost: SORCERY_POINTS(1) }],
  "twinned-spell": [{ kind: "metamagic", option: "twinned", resourceCost: SORCERY_POINTS(1) }]
};

/** Where the engine's options (the 2024 rules') differ from the 2014 ones. */
const METAMAGIC_PARTIAL: Record<string, string> = {
  "careful-spell": "the creatures it chooses take no damage on their success, rather than half.",
  "extended-spell": "only a concentration spell is extended (any spell of a minute or more should be), and it gives advantage on Concentration saves.",
  "twinned-spell": "only a spell that takes more creatures with a higher slot, for 1 sorcery point (any one-creature spell, for a point a spell level)."
};

const METAMAGIC: PickOption[] = referenceOptions("sorcerer_metamagic", "Metamagic", METAMAGIC_EFFECTS, METAMAGIC_PARTIAL);
const metamagic = (count: number) => ({ kind: "pick" as const, id: "metamagic-options", label: "Metamagic options", count, options: METAMAGIC });

/** The sorcerer's spells, most wanted first (it knows only so many: the earliest of each level are taken). */
export const SORCERER_SPELLS_2014 = [
  "magic-missile", "shield", "burning-hands", "thunderwave", "charm-person", "mage-armor",
  "scorching-ray", "misty-step", "hold-person", "web", "shatter", "blur", "mirror-image",
  "fireball", "counterspell", "haste", "lightning-bolt", "hypnotic-pattern", "slow", "fear", "stinking-cloud", "fly",
  "greater-invisibility", "banishment", "ice-storm", "blight", "confusion", "stoneskin", "dimension-door",
  "cone-of-cold", "hold-monster", "cloudkill", "insect-plague", "dominate-person",
  "chain-lightning", "disintegrate", "circle-of-death", "sunbeam",
  "finger-of-death", "fire-storm", "sunburst", "power-word-stun", "dominate-monster", "meteor-swarm"
].map(srd2014SpellId);

export const SORCERER_2014: ClassDefinition = {
  id: "srd:class:sorcerer-2014",
  name: "Sorcerer",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 6,
  primaryAbilities: ["cha"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["dagger", "dart", "sling", "quarterstaff", "light-crossbow"],
  armorTraining: [],
  // Spells known, from the class's table.
  spellcasting: { ability: "cha", kind: "full", list: "sorcerer-2014", cantrips: srd14Numbers("sorcerer", "cantrips-known"), prepared: srd14Numbers("sorcerer", "spells-known") },
  subclassLevel: 1,
  subclassLabel: "Sorcerous Origin",
  featLevels: [4, 8, 12, 16, 19],
  table: srd14Columns("sorcerer"),
  levels: [
    {
      level: 1,
      grants: [grant("spellcasting", runs("sorcerer_spellcasting"))],
      choices: [choice({ kind: "subclass", id: "subclass" }, "sorcerer_sorcerous-origin")]
    },
    {
      level: 2,
      grants: [grant("font-of-magic", fontOfMagic, {
        pool: { id: "sorcery-points", size: "{col:sorcery-points}" },
        scale: [{ path: "grantedActions.0.gains.max", value: "{col:sorcery-points}" }]
      })]
    },
    { level: 3, grants: [], choices: [choice(metamagic(2), "sorcerer_metamagic")] },
    { level: 10, grants: [], choices: [metamagic(1)] },
    { level: 17, grants: [], choices: [metamagic(1)] },
    // Points back on a short rest: a fight starts with them all.
    { level: 20, grants: [grant("sorcerous-restoration", informational("sorcerer_sorcerous-restoration"))] }
  ],
  equipmentLines: [
    {
      id: "weapon",
      options: [
        { id: "a", label: "(a) A light crossbow and 20 bolts", items: [{ ref: "srd:weapon:light-crossbow" }] },
        { id: "b", label: "(b) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "A component pouch or an arcane focus, a pack and two daggers", items: [{ ref: "srd:weapon:dagger", count: 2 }] }] }
  ],
  suggested: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte-2014",
    skills: ["arcana", "persuasion", "intimidation", "deception"],
    equipmentLines: { weapon: "a", kit: "a" },
    cantrips: ["fire-bolt", "ray-of-frost", "shocking-grasp", "chill-touch", "acid-splash", "poison-spray"].map(srd2014SpellId),
    spells: SORCERER_SPELLS_2014
  },
  description: "A spellcaster who draws on inherent magic from a gift or bloodline."
};

/** The ten dragons: each one's damage type, which its Elemental Affinity (6th level) takes. */
const DRAGONS: Array<[string, string, DamageType]> = [
  ["black", "Black", "acid"], ["blue", "Blue", "lightning"], ["brass", "Brass", "fire"], ["bronze", "Bronze", "lightning"],
  ["copper", "Copper", "acid"], ["gold", "Gold", "fire"], ["green", "Green", "poison"], ["red", "Red", "fire"],
  ["silver", "Silver", "cold"], ["white", "White", "cold"]
];

/** A dragon ancestor: its Elemental Affinity at 6th level, the Charisma on its type's spells and a resistance for a point. */
const ancestor = ([id, name, type]: [string, string, DamageType]): PickOption => ({
  id, name: `${name} (${type})`,
  grants: [{
    key: "elemental-affinity", atLevel: 6,
    feature: runs("draconic-bloodline_elemental-affinity", {
      name: `Elemental Affinity (${type})`,
      effects: [{ kind: "spell-damage-ability", ability: "cha", spellsOnly: true, damageTypes: [type] }],
      grantedActions: [{
        kind: "activate-feature", id: "elemental-affinity-resistance", name: `Elemental Affinity: ${type} resistance`, actionType: "free", featureId: "",
        resourceCost: SORCERY_POINTS(1),
        condition: { id: "elemental-affinity-resistance", name: "custom", durationRounds: 600, effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } }] },
        automationSupport: "full"
      }],
      notSimulated: "the resistance can be bought at any time, not only along with a spell of its type."
    })
  }]
});

export const DRACONIC_BLOODLINE_2014: SubclassDefinition = {
  id: "srd:subclass:draconic-bloodline-2014",
  name: "Draconic Bloodline",
  source: srd51Source("srd_draconic-bloodline"),
  edition: "2014",
  classId: "srd:class:sorcerer-2014",
  levels: [
    {
      level: 1,
      grants: [
        // Draconic, and Charisma checks with dragons: outside a fight.
        grant("dragon-ancestor", informational("draconic-bloodline_dragon-ancestor")),
        // +1 hit point a sorcerer level, and 13 + Dexterity without armor.
        grant("draconic-resilience", runs("draconic-bloodline_draconic-resilience", {
          effects: [{ kind: "unarmored-ac", base: 13, abilities: ["dex"] }]
        }), { adjust: { hpBonus: "{level}" } })
      ],
      choices: [{ kind: "pick", id: "dragon-ancestor", label: "Dragon Ancestor", count: 1, options: DRAGONS.map(ancestor) }]
    },
    {
      level: 14,
      // A bonus action: a fly speed equal to its speed, until it dismisses them.
      grants: [grant("dragon-wings", runs("draconic-bloodline_dragon-wings", {
        grantedActions: [{
          kind: "activate-feature", id: "dragon-wings", name: "Dragon Wings", actionType: "bonus", featureId: "",
          condition: { id: "dragon-wings-active", name: "custom", durationRounds: 600, modifiers: { flySpeed: "walk" } },
          automationSupport: "full"
        }]
      }))]
    },
    // 5 points: a 60-ft aura of awe or fear, a Wisdom save each turn for hostile creatures in it, with concentration.
    { level: 18, grants: [grant("draconic-presence", reference("draconic-bloodline_draconic-presence"))] }
  ]
};
