import type { DamageType } from "@/engine";
import type { ClassDefinition, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdReferenceOptions, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";
import { WIZARD_SPELLS } from "./wizard";

const ref = srdClass("sorcerer");

const innateSorcery = runs("sorcerer_innate-sorcery", {
  grantedActions: [{
    kind: "activate-feature", id: "innate-sorcery", name: "Innate Sorcery", actionType: "bonus", featureId: "",
    resourceCost: { resourceId: "innate-sorcery", amount: 1 },
    condition: {
      id: "innate-sorcery-active", name: "custom", durationRounds: 10,
      effects: [
        { kind: "save-dc-bonus", bonus: { base: 1 }, spellsOnly: true },
        { kind: "attack-advantage", condition: "always", spellsOnly: true }
      ]
    },
    automationSupport: "full"
  }],
  notSimulated: "it applies to every spell the sorcerer casts, not only Sorcerer spells."
});

const METAMAGIC = srdReferenceOptions("sorcerer_metamagic-options", "Metamagic");
const metamagic = (count: number) => ({ kind: "pick" as const, id: "metamagic-options", label: "Metamagic options", count, options: METAMAGIC });

export const SORCERER: ClassDefinition = {
  id: "srd:class:sorcerer",
  name: "Sorcerer",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 6,
  primaryAbilities: ["cha"],
  saves: ["con", "cha"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: [],
  spellcasting: srdSpellcasting("sorcerer", "cha", "full"),
  subclassLevel: 3,
  subclassLabel: "Sorcerer Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("sorcerer"),
  levels: [
    {
      level: 1,
      grants: [
        grant("spellcasting", runs("sorcerer_spellcasting")),
        grant("innate-sorcery", innateSorcery, { pool: { id: "innate-sorcery", size: 2 } })
      ]
    },
    {
      level: 2,
      grants: [
        grant("font-of-magic", reference("sorcerer_font-of-magic"), { pool: { id: "sorcery-points", size: "{col:sorcery-points}" } }),
        grant("metamagic", reference("sorcerer_metamagic"))
      ],
      choices: [choice(metamagic(2), "sorcerer_metamagic-options")]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "sorcerer_sorcerer-subclass")] },
    { level: 5, grants: [grant("sorcerous-restoration", informational("sorcerer_sorcerous-restoration"))] },
    { level: 7, grants: [grant("sorcery-incarnate", reference("sorcerer_sorcery-incarnate"))] },
    { level: 10, grants: [], choices: [metamagic(2)] },
    { level: 17, grants: [], choices: [metamagic(2)] },
    { level: 20, grants: [grant("arcane-apotheosis", reference("sorcerer_arcane-apotheosis"))] }
  ],
  startingEquipment: [
    { id: "A", label: "A spear, two daggers, an arcane focus (crystal), a dungeoneer's pack and 28 GP", items: [{ ref: "srd:weapon:spear" }, { ref: "srd:weapon:dagger", count: 2 }], gold: 28 },
    { id: "B", label: "50 GP", items: [], gold: 50 }
  ],
  suggested: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte",
    skills: ["arcana", "persuasion", "intimidation", "deception"],
    epicBoon: "srd:feat:boon-of-dimensional-travel",
    equipment: "A",
    cantrips: ["sorcerous-burst", "fire-bolt", "ray-of-frost", "shocking-grasp", "chill-touch", "acid-splash", "poison-spray"].map(spell),
    spells: WIZARD_SPELLS
  },
  description: "A spellcaster whose magic is innate, shaped with Metamagic."
};

const AFFINITIES: DamageType[] = ["acid", "cold", "fire", "lightning", "poison"];
const affinity = (type: DamageType): PickOption => {
  const name = `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  return {
    id: type,
    name,
    grants: [{
      key: "elemental-affinity",
      feature: runs("sorcerer_draconic-sorcery_elemental-affinity", {
        name: `Elemental Affinity (${name})`,
        effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } }],
        notSimulated: `adding Charisma to one damage roll of a spell that deals ${type} damage.`
      })
    }]
  };
};

export const DRACONIC_SORCERY: SubclassDefinition = {
  id: "srd:subclass:draconic-sorcery",
  name: "Draconic Sorcery",
  source: srd52Source("srd-2024_draconic-sorcery"),
  edition: "2024",
  classId: "srd:class:sorcerer",
  levels: [
    {
      level: 3,
      grants: [
        grant("draconic-resilience", runs("sorcerer_draconic-sorcery_draconic-resilience", {
          effects: [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "cha"] }]
        }), { adjust: { hpBonus: "{level}" } }),
        grant("draconic-spells", runs("sorcerer_draconic-sorcery_draconic-spells"), {
          spells: ["alter-self", "chromatic-orb", "command", "dragons-breath"].map(spell)
        })
      ]
    },
    { level: 5, grants: [{ key: "draconic-spells-5", spells: ["fear", "fly"].map(spell) }] },
    {
      level: 6,
      grants: [],
      choices: [choice({ kind: "pick", id: "elemental-affinity", label: "Elemental Affinity", count: 1, options: AFFINITIES.map(affinity) }, "sorcerer_draconic-sorcery_elemental-affinity")]
    },
    { level: 7, grants: [{ key: "draconic-spells-7", spells: ["arcane-eye", "charm-monster"].map(spell) }] },
    { level: 9, grants: [{ key: "draconic-spells-9", spells: ["legend-lore", "summon-dragon"].map(spell) }] },
    { level: 14, grants: [grant("dragon-wings", reference("sorcerer_draconic-sorcery_dragon-wings"))] },
    { level: 18, grants: [grant("dragon-companion", reference("sorcerer_draconic-sorcery_dragon-companion"))] }
  ]
};
