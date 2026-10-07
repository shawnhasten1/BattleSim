import type { ClassDefinition, SpellsChoice, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { choice, grant, informational, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Numbers } from "../reference";

/**
 * The 2014 Wizard and its School of Evocation (SRD 5.1). It prepares its Intelligence modifier plus its level from its
 * spellbook (six spells, two more a level), and chooses its tradition at 2nd level. Spell Mastery, Signature Spells,
 * Sculpt Spells, Empowered Evocation and Overchannel run as their 2024 namesakes do; Potent Cantrip is a save's half.
 */
const ref = srd14Class("wizard");

/** The wizard's spells, most wanted first; a choice takes the highest level it can, so this is read level by level. */
export const WIZARD_SPELLS_2014 = [
  "magic-missile", "shield", "burning-hands", "thunderwave", "grease", "hideous-laughter", "charm-person", "mage-armor",
  "scorching-ray", "misty-step", "hold-person", "web", "shatter", "blur", "mirror-image", "acid-arrow",
  "fireball", "counterspell", "lightning-bolt", "hypnotic-pattern", "slow", "haste", "fear", "stinking-cloud", "fly",
  "ice-storm", "black-tentacles", "banishment", "greater-invisibility", "blight", "confusion", "stoneskin", "dimension-door",
  "cone-of-cold", "hold-monster", "cloudkill", "dominate-person",
  "chain-lightning", "disintegrate", "circle-of-death", "freezing-sphere", "sunbeam",
  "finger-of-death", "sunburst", "power-word-stun", "dominate-monster", "meteor-swarm"
].map(srd2014SpellId);

/** A spell from the wizard's book, also cast without a slot (Spell Mastery, Signature Spells). */
const fromBook = (id: string, level: number, count: number, freeCasts: SpellsChoice["freeCasts"], label: string): SpellsChoice & { id: string } => ({
  kind: "spells", id, what: "prepared", from: "spellbook", level, count, alwaysPrepared: true, freeCasts, label
});

export const WIZARD_2014: ClassDefinition = {
  id: "srd:class:wizard-2014",
  name: "Wizard",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 6,
  primaryAbilities: ["int"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["dagger", "dart", "sling", "quarterstaff", "light-crossbow"],
  armorTraining: [],
  spellcasting: {
    ability: "int", kind: "full", list: "wizard-2014",
    cantrips: srd14Numbers("wizard", "cantrips-known"),
    prepared: Array.from({ length: 20 }, () => 0),
    preparedFormula: { add: "level" },
    spellbook: { start: 6, perLevel: 2 }
  },
  subclassLevel: 2,
  subclassLabel: "Arcane Tradition",
  featLevels: [4, 8, 12, 16, 19],
  table: srd14Columns("wizard"),
  levels: [
    {
      level: 1,
      grants: [
        grant("spellcasting", runs("wizard_spellcasting")),
        // Slots back on a short rest: a fight starts with full slots.
        grant("arcane-recovery", informational("wizard_arcane-recovery"))
      ]
    },
    { level: 2, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "wizard_arcane-tradition")] },
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
      // Each once between rests: once a fight.
      grants: [grant("signature-spells", runs("wizard_signature-spells"))],
      choices: [fromBook("signature-spells", 3, 2, 1, "Signature Spells: two 3rd-level spells, each once without a slot")]
    }
  ],
  equipmentLines: [
    {
      id: "weapon",
      options: [
        { id: "a", label: "(a) A quarterstaff", items: [{ ref: "srd:weapon:quarterstaff" }] },
        { id: "b", label: "(b) A dagger", items: [{ ref: "srd:weapon:dagger" }] }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "A component pouch or an arcane focus, a pack and a spellbook", items: [] }] }
  ],
  suggested: {
    abilities: ["int", "con", "dex", "wis", "cha", "str"],
    tactics: "controller",
    background: "srd:background:acolyte-2014",
    skills: ["arcana", "investigation", "insight", "history"],
    equipmentLines: { weapon: "a", kit: "a" },
    cantrips: ["fire-bolt", "ray-of-frost", "shocking-grasp", "chill-touch", "acid-splash", "poison-spray"].map(srd2014SpellId),
    spells: WIZARD_SPELLS_2014
  },
  description: "A scholarly magic-user capable of manipulating the structures of reality."
};

export const EVOCATION_2014: SubclassDefinition = {
  id: "srd:subclass:school-of-evocation-2014",
  name: "School of Evocation",
  source: srd51Source("srd_school-of-evocation"),
  edition: "2014",
  classId: "srd:class:wizard-2014",
  levels: [
    {
      level: 2,
      grants: [
        // Copying evocations into the book for half the gold and time.
        grant("evocation-savant", informational("school-of-evocation_evocation-savant")),
        // Its evocations spare 1 + the spell's level of the creatures it chooses: a success, and no damage instead of half.
        grant("sculpt-spells", runs("school-of-evocation_sculpt-spells", { effects: [{ kind: "spare-allies", base: 1, plusSpellLevel: true, spellSchools: ["evocation"] }] }))
      ]
    },
    // Half a damaging cantrip's damage on a successful save (not on a miss, as the 2024 rule has it).
    { level: 6, grants: [grant("potent-cantrip", runs("school-of-evocation_potent-cantrip", { effects: [{ kind: "spell-half-on-miss", cantripsOnly: true, savesOnly: true }] }))] },
    {
      level: 10,
      grants: [grant("empowered-evocation", runs("school-of-evocation_empowered-evocation", {
        effects: [{ kind: "spell-damage-ability", ability: "int", spellSchools: ["evocation"], spellClasses: ["wizard"] }]
      }))]
    },
    {
      level: 14,
      // A wizard spell of level 1-5 that deals damage, at its maximum: the first time, with no harm, so once a fight.
      grants: [grant("overchannel", runs("school-of-evocation_overchannel", {
        effects: [{ kind: "max-damage", maxSlot: 5, resourceCost: { resourceId: "overchannel", amount: 1 }, spellClasses: ["wizard"] }],
        notSimulated: "using it again before a long rest, for necrotic damage to itself."
      }), { pool: { id: "overchannel", size: 1 } })]
    }
  ]
};
