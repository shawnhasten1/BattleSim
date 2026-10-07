import type { ClassDefinition, SpellsChoice, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Numbers } from "../reference";

/**
 * The 2014 Bard and its College of Lore (SRD 5.1). It knows its spells (the Spells Known column), inspires with a die
 * that grows at 5th, 10th and 15th level, and learns spells from any class with Magical Secrets (10th, 14th, 18th) and
 * Additional Magical Secrets (Lore, 6th). Cutting Words runs as the 2024 one does; Countercharm is a performance for
 * its allies nearby rather than a reaction.
 */
const ref = srd14Class("bard");

/** Every class's 2014 list: what Magical Secrets chooses from. */
const ALL_LISTS = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"].map((list) => `${list}-2014`);

/** Bardic Inspiration's die: a d6, a d8 from 5th level, a d10 from 10th, a d12 from 15th. */
const BARDIC_DIE = Array.from({ length: 20 }, (_, index) => (index + 1 >= 15 ? "d12" : index + 1 >= 10 ? "d10" : index + 1 >= 5 ? "d8" : "d6"));

/** Magical Secrets' spells are in the Spells Known column: two at 10th, 14th and 18th, chosen apart from the rest. */
const SECRETS = (level: number) => (level >= 18 ? 6 : level >= 14 ? 4 : level >= 10 ? 2 : 0);
const KNOWN = srd14Numbers("bard", "spells-known").map((count, index) => count - SECRETS(index + 1));

const magicalSecrets = (level: number): SpellsChoice & { id: string } => ({
  kind: "spells", id: `magical-secrets-${level}`, what: "prepared", count: 2, lists: ALL_LISTS, minLevel: 0, alwaysPrepared: true,
  label: "Magical Secrets: two spells from any class"
});

export const BARD_SPELLS_2014 = [
  "healing-word", "hideous-laughter", "thunderwave", "bane", "charm-person", "cure-wounds",
  "hold-person", "shatter", "heat-metal", "blindnessdeafness",
  "hypnotic-pattern", "fear", "stinking-cloud",
  "confusion", "greater-invisibility", "dimension-door",
  "hold-monster", "mass-cure-wounds", "dominate-person",
  "power-word-stun", "dominate-monster"
].map(srd2014SpellId);

export const BARD_2014: ClassDefinition = {
  id: "srd:class:bard-2014",
  name: "Bard",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 8,
  primaryAbilities: ["cha"],
  // As a multiclass character: one skill of any kind.
  multiclass: { skills: 1 },
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "hand-crossbow", "longsword", "rapier", "shortsword"],
  armorTraining: ["light"],
  spellcasting: { ability: "cha", kind: "full", list: "bard-2014", cantrips: srd14Numbers("bard", "cantrips-known"), prepared: KNOWN },
  subclassLevel: 3,
  subclassLabel: "Bard College",
  featLevels: [4, 8, 12, 16, 19],
  table: [...srd14Columns("bard"), { id: "bardic-die", label: "Bardic Inspiration", values: BARDIC_DIE }],
  levels: [
    {
      level: 1,
      grants: [
        grant("bardic-inspiration", runs("bard_bardic-inspiration", {
          grantedActions: [{
            kind: "buff", id: "bardic-inspiration", name: "Bardic Inspiration", actionType: "bonus", range: 60, targeting: { target: "single", notSelf: true },
            appliedCondition: {
              id: "bardic-inspiration", name: "custom", durationRounds: 100,
              effects: [{ kind: "d20-change", rolls: ["attack", "save"], change: "add", dice: "1d6", usedUp: true }]
            },
            resourceCost: { resourceId: "bardic-inspiration", amount: 1 }, automationSupport: "full"
          }]
        }), {
          pool: { id: "bardic-inspiration", size: "{mod:cha|min:1}" },
          scale: [{ path: "grantedActions.0.appliedCondition.effects.0.dice", value: "1{col:bardic-die}" }]
        }),
        grant("spellcasting", runs("bard_spellcasting"))
      ]
    },
    {
      level: 2,
      grants: [
        // Half its proficiency bonus on checks without it, and more hit points on a short rest: outside a fight.
        grant("jack-of-all-trades", informational("bard_jack-of-all-trades")),
        grant("song-of-rest", informational("bard_song-of-rest"))
      ]
    },
    {
      level: 3,
      grants: [],
      choices: [
        choice({ kind: "subclass", id: "subclass" }, "bard_bard-college"),
        choice({ kind: "expertise", id: "expertise", count: 2 }, "bard_expertise")
      ]
    },
    // Its uses back on a short rest: a fight starts with them all.
    { level: 5, grants: [grant("font-of-inspiration", informational("bard_font-of-inspiration"))] },
    // An action: it and its allies within 30 ft have advantage on saves against being frightened or charmed, to its next turn's end.
    { level: 6, grants: [grant("countercharm", reference("bard_countercharm"))] },
    {
      level: 10,
      grants: [grant("magical-secrets", runs("bard_magical-secrets"))],
      choices: [{ kind: "expertise", id: "expertise", count: 2 }, magicalSecrets(10)]
    },
    { level: 14, grants: [], choices: [magicalSecrets(14)] },
    { level: 18, grants: [], choices: [magicalSecrets(18)] },
    // A use back on rolling initiative with none left: a fight starts with them all.
    { level: 20, grants: [grant("superior-inspiration", informational("bard_superior-inspiration"))] }
  ],
  equipmentLines: [
    {
      id: "weapon",
      options: [
        { id: "a", label: "(a) A rapier", items: [{ ref: "srd:weapon:rapier" }] },
        { id: "b", label: "(b) A longsword", items: [{ ref: "srd:weapon:longsword" }] },
        { id: "c", label: "(c) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "A pack, a musical instrument, leather armor and a dagger", items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:dagger" }] }] }
  ],
  suggested: {
    abilities: ["cha", "dex", "con", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte-2014",
    skills: ["persuasion", "performance", "deception", "perception", "intimidation", "acrobatics"],
    expertise: ["persuasion", "performance", "perception", "deception"],
    equipmentLines: { weapon: "a", kit: "a" },
    cantrips: ["vicious-mockery", "dancing-lights", "minor-illusion", "light"].map(srd2014SpellId),
    spells: BARD_SPELLS_2014
  },
  description: "An inspiring magician whose power echoes the music of creation."
};

/** Cutting Words: a foe's attack roll (or its damage roll, against the bard or an ally) within 60 ft loses a die. */
const cuttingWords = runs("college-of-lore_cutting-words", {
  effects: [{
    kind: "d20-change", rolls: ["attack"], change: "subtract", dice: "1d6", reaction: true, againstFoes: { withinFt: 60 },
    resourceCost: { resourceId: "bardic-inspiration", amount: 1 }
  }],
  grantedActions: [{
    kind: "activate-feature", id: "cutting-words-damage", name: "Cutting Words (damage)", actionType: "reaction", featureId: "",
    reaction: { trigger: { kind: "would-take-damage", forAllies: { withinFt: 60 } }, target: "self", priority: "worthwhile" },
    damageCut: { kind: "reduce", dice: "1d6" }, resourceCost: { resourceId: "bardic-inspiration", amount: 1 }, automationSupport: "full"
  }]
});

export const COLLEGE_OF_LORE_2014: SubclassDefinition = {
  id: "srd:subclass:college-of-lore-2014",
  name: "College of Lore",
  source: srd51Source("srd_college-of-lore"),
  edition: "2014",
  classId: "srd:class:bard-2014",
  levels: [
    {
      level: 3,
      grants: [grant("cutting-words", cuttingWords, {
        scale: [{ path: "effects.0.dice", value: "1{col:bardic-die}" }, { path: "grantedActions.0.damageCut.dice", value: "1{col:bardic-die}" }]
      })],
      choices: [choice({ kind: "skills", id: "bonus-proficiencies", count: 3, from: "any" }, "college-of-lore_bonus-proficiencies")]
    },
    {
      level: 6,
      grants: [],
      choices: [choice({
        kind: "spells", id: "additional-magical-secrets", what: "prepared", count: 2, lists: ALL_LISTS, minLevel: 0, alwaysPrepared: true,
        label: "Additional Magical Secrets: two spells from any class"
      }, "college-of-lore_additional-magical-secrets")]
    },
    // An inspiration die on its own ability check: outside a fight.
    { level: 14, grants: [grant("peerless-skill", informational("college-of-lore_peerless-skill"))] }
  ]
};
