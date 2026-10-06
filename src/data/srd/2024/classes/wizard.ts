import type { ClassDefinition, SpellsChoice, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("wizard");

/** The wizard's spells, most wanted first; a choice takes the highest level it can, so this is read level by level. */
export const WIZARD_SPELLS = [
  "magic-missile", "shield", "burning-hands", "thunderwave", "chromatic-orb", "grease", "hideous-laughter", "charm-person", "mage-armor",
  "scorching-ray", "misty-step", "hold-person", "web", "shatter", "blur", "mirror-image", "acid-arrow", "blindnessdeafness",
  "fireball", "lightning-bolt", "hypnotic-pattern", "slow", "fear", "stinking-cloud", "counterspell",
  "ice-storm", "black-tentacles", "banishment", "greater-invisibility", "blight", "confusion", "stoneskin", "dimension-door",
  "cone-of-cold", "hold-monster", "cloudkill", "dominate-person",
  "chain-lightning", "disintegrate", "circle-of-death", "freezing-sphere", "sunbeam",
  "finger-of-death", "sunburst", "power-word-stun", "dominate-monster", "meteor-swarm"
].map(spell);

/** A spell from the wizard's book, also cast without a slot (Spell Mastery, Signature Spells). */
const fromBook = (id: string, level: number, count: number, freeCasts: SpellsChoice["freeCasts"], label: string): SpellsChoice & { id: string } => ({
  kind: "spells", id, what: "prepared", from: "spellbook", level, count, alwaysPrepared: true, freeCasts, label
});

export const WIZARD: ClassDefinition = {
  id: "srd:class:wizard",
  name: "Wizard",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 6,
  primaryAbilities: ["int"],
  saves: ["int", "wis"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: [],
  spellcasting: srdSpellcasting("wizard", "int", "full", { spellbook: { start: 6, perLevel: 2 } }),
  subclassLevel: 3,
  subclassLabel: "Wizard Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("wizard"),
  levels: [
    {
      level: 1,
      grants: [
        grant("spellcasting", runs("wizard_spellcasting")),
        grant("arcane-recovery", informational("wizard_arcane-recovery")),
        grant("ritual-adept", informational("wizard_ritual-adept"))
      ]
    },
    {
      level: 2,
      grants: [],
      choices: [choice({ kind: "expertise", id: "scholar", count: 1, from: ["arcana", "history", "investigation", "medicine", "nature", "religion"] }, "wizard_scholar")]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "wizard_wizard-subclass")] },
    { level: 5, grants: [grant("memorize-spell", informational("wizard_memorize-spell"))] },
    {
      level: 18,
      grants: [grant("spell-mastery", runs("wizard_spell-mastery"))],
      choices: [
        { ...fromBook("spell-mastery-1", 1, 1, "at-will", "Spell Mastery: a 1st-level spell, at will"), actionOnly: true },
        { ...fromBook("spell-mastery-2", 2, 1, "at-will", "Spell Mastery: a 2nd-level spell, at will"), actionOnly: true }
      ]
    },
    {
      level: 20,
      grants: [grant("signature-spells", runs("wizard_signature-spells"))],
      choices: [fromBook("signature-spells", 3, 2, 1, "Signature Spells: two 3rd-level spells, each once without a slot")]
    }
  ],
  startingEquipment: [
    { id: "A", label: "Two daggers, a quarterstaff (an arcane focus), a robe, a spellbook, a scholar's pack and 5 GP", items: [{ ref: "srd:weapon:dagger", count: 2 }, { ref: "srd:weapon:quarterstaff" }], gold: 5 },
    { id: "B", label: "55 GP", items: [], gold: 55 }
  ],
  suggested: {
    abilities: ["int", "con", "dex", "wis", "cha", "str"],
    tactics: "controller",
    background: "srd:background:sage",
    skills: ["investigation", "insight", "arcana", "history"],
    expertise: ["arcana"],
    epicBoon: "srd:feat:boon-of-spell-recall",
    equipment: "A",
    cantrips: ["fire-bolt", "ray-of-frost", "shocking-grasp", "chill-touch", "acid-splash", "poison-spray"].map(spell),
    spells: WIZARD_SPELLS
  },
  description: "A scholarly magic-user who prepares spells from a spellbook."
};

/** Evocation Savant: an evocation spell for the book whenever a new level of slots arrives (3rd at 5th level …). */
const savant = (level: number) => ({
  level,
  grants: [],
  choices: [{ kind: "spells" as const, id: "evocation-savant", what: "spellbook" as const, count: 1, school: "evocation", label: "Evocation Savant: an evocation spell for the spellbook" }]
});

export const EVOKER: SubclassDefinition = {
  id: "srd:subclass:evoker",
  name: "Evoker",
  source: srd52Source("srd-2024_evoker"),
  edition: "2024",
  classId: "srd:class:wizard",
  levels: [
    {
      level: 3,
      grants: [grant("potent-cantrip", runs("wizard_evoker_potent-cantrip", { effects: [{ kind: "spell-half-on-miss", cantripsOnly: true }] }))],
      choices: [choice({
        kind: "spells", id: "evocation-savant", what: "spellbook", count: 2, school: "evocation", maxLevel: 2,
        label: "Evocation Savant: two evocation spells for the spellbook"
      }, "wizard_evoker_evocation-savant")]
    },
    savant(5),
    { level: 6, grants: [grant("sculpt-spells", reference("wizard_evoker_sculpt-spells"))] },
    savant(7),
    savant(9),
    {
      level: 10,
      grants: [grant("empowered-evocation", runs("wizard_evoker_empowered-evocation", {
        effects: [{ kind: "spell-damage-ability", ability: "int", spellSchools: ["evocation"], spellClasses: ["wizard"] }]
      }))]
    },
    savant(11),
    savant(13),
    { level: 14, grants: [grant("overchannel", reference("wizard_evoker_overchannel"))] },
    savant(15),
    savant(17)
  ]
};
