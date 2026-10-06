import type { Ability } from "@/engine";
import type { FeatDefinition } from "@/lib/character-builder/catalog";
import { informational, reference, runs } from "./authoring";
import { srd52Source } from "./reference";

const ANY: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const source = (slug: string) => srd52Source(`srd-2024_${slug}`);

/** An Epic Boon: +1 to any score up to 30, and its own benefit. */
function epicBoon(slug: string, name: string, feature: FeatDefinition["grants"][number]["feature"], extra: Partial<FeatDefinition> = {}): FeatDefinition {
  return {
    id: `srd:feat:${slug}`,
    name,
    source: source(slug),
    edition: "2024",
    category: "epic-boon",
    prerequisite: { level: 19, ...(extra.prerequisite ?? {}) },
    grants: [{ key: "feat", feature }, ...(extra.grants ?? [])],
    choices: [{ kind: "abilities", id: "increase", label: "+1 to one score, to a maximum of 30", points: 1, from: ANY, maxPerAbility: 1, cap: 30 }]
  };
}

/** The SRD 5.2's 17 feats. Each puts itself on the actor as a feature, its text the SRD's. */
export const SRD_2024_FEATS: FeatDefinition[] = [
  {
    id: "srd:feat:ability-score-improvement",
    name: "Ability Score Improvement",
    source: source("ability-score-improvement"),
    edition: "2024",
    category: "general",
    prerequisite: { level: 4 },
    repeatable: true,
    grants: [{ key: "feat", feature: informational({ feat: "ability-score-improvement" }) }],
    choices: [{ kind: "abilities", id: "increase", label: "+2 to one score, or +1 to two", points: 2, from: ANY, maxPerAbility: 2, cap: 20 }]
  },
  {
    id: "srd:feat:grappler",
    name: "Grappler",
    source: source("grappler"),
    edition: "2024",
    category: "general",
    prerequisite: { level: 4, abilities: { str: 13, dex: 13 }, anyOf: true },
    grants: [{
      key: "feat",
      feature: runs({ feat: "grappler" }, {
        effects: [{ kind: "attack-advantage", condition: "target-grappled-by-self" }],
        notSimulated: "damaging and grappling with the same Unarmed Strike, and moving a grappled creature at no extra cost."
      })
    }],
    choices: [{ kind: "abilities", id: "increase", label: "+1 to Strength or Dexterity", points: 1, from: ["str", "dex"], maxPerAbility: 1, cap: 20 }]
  },
  {
    id: "srd:feat:alert",
    name: "Alert",
    source: source("alert"),
    edition: "2024",
    category: "origin",
    grants: [{ key: "feat", feature: runs({ feat: "alert" }, { effects: [{ kind: "initiative", bonus: { proficiency: true } }], notSimulated: "swapping initiative with a willing ally." }) }]
  },
  {
    id: "srd:feat:magic-initiate",
    name: "Magic Initiate",
    source: source("magic-initiate"),
    edition: "2024",
    category: "origin",
    repeatable: true,
    // The feature is the text; the spells chosen below go on the actor as spells (its 1st-level one also as a free cast).
    grants: [{ key: "feat", feature: informational({ feat: "magic-initiate" }) }],
    choices: [
      {
        kind: "pick", id: "list", label: "Spell list", count: 1,
        options: [
          { id: "cleric", name: "Cleric", grants: [] },
          { id: "druid", name: "Druid", grants: [] },
          { id: "wizard", name: "Wizard", grants: [] }
        ]
      },
      {
        kind: "pick", id: "ability", label: "Spellcasting ability", count: 1,
        options: [
          { id: "int", name: "Intelligence", grants: [] },
          { id: "wis", name: "Wisdom", grants: [] },
          { id: "cha", name: "Charisma", grants: [] }
        ]
      },
      { kind: "spells", id: "cantrips", what: "cantrips", label: "Two cantrips", count: 2, listFrom: "list", abilityFrom: "ability" },
      {
        kind: "spells", id: "spell", what: "prepared", label: "A 1st-level spell, always prepared", count: 1, level: 1,
        listFrom: "list", abilityFrom: "ability", alwaysPrepared: true, freeCasts: 1
      }
    ]
  },
  {
    id: "srd:feat:savage-attacker",
    name: "Savage Attacker",
    source: source("savage-attacker"),
    edition: "2024",
    category: "origin",
    grants: [{ key: "feat", feature: reference({ feat: "savage-attacker" }) }]
  },
  {
    id: "srd:feat:skilled",
    name: "Skilled",
    source: source("skilled"),
    edition: "2024",
    category: "origin",
    repeatable: true,
    grants: [{ key: "feat", feature: informational({ feat: "skilled" }) }],
    choices: [{ kind: "skills", id: "skills", count: 3, from: "any" }]
  },
  {
    id: "srd:feat:archery",
    name: "Archery",
    source: source("archery"),
    edition: "2024",
    category: "fighting-style",
    prerequisite: { feature: "Fighting Style" },
    grants: [{ key: "feat", feature: runs({ feat: "archery" }, { effects: [{ kind: "attack-bonus", bonus: { base: 2 }, attackTypes: ["ranged"] }] }) }]
  },
  {
    id: "srd:feat:defense",
    name: "Defense",
    source: source("defense"),
    edition: "2024",
    category: "fighting-style",
    prerequisite: { feature: "Fighting Style" },
    grants: [{ key: "feat", feature: runs({ feat: "defense" }, { effects: [{ kind: "armor-class-bonus", bonus: { base: 1 } }] }) }]
  },
  {
    id: "srd:feat:great-weapon-fighting",
    name: "Great Weapon Fighting",
    source: source("great-weapon-fighting"),
    edition: "2024",
    category: "fighting-style",
    prerequisite: { feature: "Fighting Style" },
    grants: [{ key: "feat", feature: reference({ feat: "great-weapon-fighting" }) }]
  },
  {
    id: "srd:feat:two-weapon-fighting",
    name: "Two-Weapon Fighting",
    source: source("two-weapon-fighting"),
    edition: "2024",
    category: "fighting-style",
    prerequisite: { feature: "Fighting Style" },
    // The simulator already adds the ability modifier to a light weapon's off-hand attack, so there's nothing to switch on.
    grants: [{ key: "feat", feature: runs({ feat: "two-weapon-fighting" }) }]
  },
  epicBoon("boon-of-combat-prowess", "Boon of Combat Prowess", reference({ feat: "boon-of-combat-prowess" })),
  epicBoon("boon-of-dimensional-travel", "Boon of Dimensional Travel", reference({ feat: "boon-of-dimensional-travel" })),
  epicBoon("boon-of-fate", "Boon of Fate", reference({ feat: "boon-of-fate" })),
  epicBoon("boon-of-irresistible-offense", "Boon of Irresistible Offense", reference({ feat: "boon-of-irresistible-offense" })),
  epicBoon("boon-of-spell-recall", "Boon of Spell Recall", reference({ feat: "boon-of-spell-recall" }), { prerequisite: { feature: "Spellcasting" } }),
  epicBoon("boon-of-the-night-spirit", "Boon of the Night Spirit", reference({ feat: "boon-of-the-night-spirit" })),
  epicBoon("boon-of-truesight", "Boon of Truesight", informational({ feat: "boon-of-truesight" }), {
    grants: [{ key: "truesight", adjust: { senses: { truesight: 60 } } }]
  })
];
