import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("bard");

export const BARD_SPELLS = [
  "healing-word", "dissonant-whispers", "hideous-laughter", "thunderwave", "bane", "charm-person", "cure-wounds",
  "hold-person", "shatter", "heat-metal", "blindnessdeafness", "mirror-image", "aid",
  "hypnotic-pattern", "mass-healing-word", "fear", "slow", "stinking-cloud",
  "confusion", "greater-invisibility", "dimension-door",
  "hold-monster", "mass-cure-wounds", "dominate-person",
  "power-word-stun", "dominate-monster"
].map(spell);

export const BARD: ClassDefinition = {
  id: "srd:class:bard",
  name: "Bard",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["cha"],
  saves: ["dex", "cha"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: ["light"],
  spellcasting: srdSpellcasting("bard", "cha", "full"),
  subclassLevel: 3,
  subclassLabel: "Bard Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("bard"),
  levels: [
    {
      level: 1,
      grants: [
        grant("bardic-inspiration", reference("bard_bardic-inspiration"), { pool: { id: "bardic-inspiration", size: "{mod:cha|min:1}" } }),
        grant("spellcasting", runs("bard_spellcasting"))
      ]
    },
    {
      level: 2,
      grants: [grant("jack-of-all-trades", informational("bard_jack-of-all-trades"))],
      choices: [choice({ kind: "expertise", id: "expertise", count: 2 }, "bard_expertise")]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "bard_bard-subclass")] },
    { level: 5, grants: [grant("font-of-inspiration", reference("bard_font-of-inspiration"))] },
    { level: 7, grants: [grant("countercharm", reference("bard_countercharm"))] },
    { level: 9, grants: [], choices: [{ kind: "expertise", id: "expertise", count: 2 }] },
    {
      level: 10,
      // From now on, a prepared spell can come from the Cleric, Druid and Wizard lists too.
      grants: [grant("magical-secrets", runs("bard_magical-secrets"), { adjust: { spellLists: ["cleric", "druid", "wizard"] } })]
    },
    { level: 18, grants: [grant("superior-inspiration", informational("bard_superior-inspiration"))] },
    {
      level: 20,
      grants: [grant("words-of-creation", runs("bard_words-of-creation", { notSimulated: "a second target within 10 feet of the first." }), {
        spells: ["power-word-heal", "power-word-kill"].map(spell)
      })]
    }
  ],
  startingEquipment: [
    { id: "A", label: "Leather armor, two daggers, a musical instrument, an entertainer's pack and 19 GP", items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:dagger", count: 2 }], gold: 19 },
    { id: "B", label: "90 GP", items: [], gold: 90 }
  ],
  suggested: {
    abilities: ["cha", "dex", "con", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte",
    skills: ["persuasion", "performance", "deception", "perception", "intimidation", "acrobatics"],
    expertise: ["persuasion", "performance", "perception", "deception"],
    epicBoon: "srd:feat:boon-of-spell-recall",
    equipment: "A",
    cantrips: ["vicious-mockery", "starry-wisp", "dancing-lights", "minor-illusion", "light"].map(spell),
    spells: BARD_SPELLS
  },
  description: "An inspiring performer whose words and music carry magic."
};

/** Cutting Words' cost to the attacker's roll: the Bardic Inspiration die's average, rounded up (d6 4 … d12 7). */
const CUTTING_WORDS = Array.from({ length: 20 }, (_, index) => (index + 1 >= 15 ? 7 : index + 1 >= 10 ? 6 : index + 1 >= 5 ? 5 : 4));

const cuttingWords = runs("college-of-lore_cutting-words", {
  grantedActions: [
    {
      // An attack on an ally: disadvantage on that roll.
      kind: "activate-feature", id: "cutting-words", name: "Cutting Words", actionType: "reaction", featureId: "",
      reaction: { trigger: { kind: "ally-targeted-by-attack", withinFt: 60 }, priority: "worthwhile" },
      resourceCost: { resourceId: "bardic-inspiration", amount: 1 }, automationSupport: "full"
    },
    {
      // A hit on the bard: the roll goes down by the die's average, used only when that makes it miss.
      kind: "activate-feature", id: "cutting-words-self", name: "Cutting Words (you)", actionType: "reaction", featureId: "",
      reaction: { trigger: { kind: "would-be-hit" }, target: "self", priority: "always", lastsFor: "triggering-attack" },
      condition: { id: "cutting-words-active", name: "custom", durationRounds: 1, modifiers: { armorClass: 4 } },
      resourceCost: { resourceId: "bardic-inspiration", amount: 1 }, automationSupport: "full"
    }
  ],
  notSimulated: "an attack on an ally gets disadvantage, and one on you loses the die's average, instead of a rolled die; it isn't used on damage rolls or ability checks."
});

export const COLLEGE_OF_LORE: SubclassDefinition = {
  id: "srd:subclass:college-of-lore",
  name: "College of Lore",
  source: srd52Source("srd-2024_college-of-lore"),
  edition: "2024",
  classId: "srd:class:bard",
  table: [{ id: "cutting-words", label: "Cutting Words penalty", values: CUTTING_WORDS }],
  levels: [
    {
      level: 3,
      grants: [grant("cutting-words", cuttingWords, { scale: [{ path: "grantedActions.1.condition.modifiers.armorClass", value: "{col:cutting-words}" }] })],
      choices: [choice({ kind: "skills", id: "bonus-proficiencies", count: 3, from: "any" }, "college-of-lore_bonus-proficiencies")]
    },
    {
      level: 6,
      grants: [],
      choices: [choice({
        kind: "spells", id: "magical-discoveries", what: "prepared", count: 2, lists: ["cleric", "druid", "wizard"], minLevel: 0, alwaysPrepared: true,
        label: "Magical Discoveries: two Cleric, Druid or Wizard spells, always prepared"
      }, "college-of-lore_magical-discoveries")]
    },
    { level: 14, grants: [grant("peerless-skill", reference("college-of-lore_peerless-skill"))] }
  ]
};
