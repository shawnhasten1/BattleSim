import type { ActionDefinition, DamageComponent, DamageType } from "@/engine";
import type { ChoiceSpec, FeatureGrant, PickOption, SpeciesDefinition } from "@/lib/character-builder/catalog";
import { HEROIC_INSPIRATION, informational, reference, runs, spell } from "./authoring";
import { srd52Source } from "./reference";

/**
 * The SRD 5.2's nine species (PC_BUILDER_PLAN.md, Phase 6). A species gives no ability increases in 2024; it gives a
 * size, a speed, senses and traits. Each trait goes on the actor with its SRD text; what runs is written here.
 */

const trait = (species: string, name: string) => ({ species, trait: name });
const source = (slug: string) => srd52Source(`srd-2024_${slug}`);

/** The spellcasting-ability choice of a lineage or legacy: its spells use the one chosen. */
const SPELLCASTING_ABILITY: ChoiceSpec = {
  kind: "pick", id: "spellcasting-ability", label: "Spellcasting ability for these spells", count: 1,
  options: [
    { id: "int", name: "Intelligence", grants: [] },
    { id: "wis", name: "Wisdom", grants: [] },
    { id: "cha", name: "Charisma", grants: [] }
  ]
};

/** A spell learned at a character level: always prepared, once without a slot (an elf's lineage, a tiefling's legacy). */
const leveledSpell = (key: string, level: 3 | 5, slug: string): FeatureGrant => ({
  key: `${key}-${level}`, atLevel: level, spells: [spell(slug)], freeCasts: [{ spell: spell(slug), uses: 1 }]
});

/** A cantrip's damage at 5th, 11th and 17th character level: 2, 3 and 4 of its die (Breath Weapon too). */
const byCharacterLevel = (die: string): NonNullable<DamageComponent["scaling"]> => ({
  mode: "cantrip-by-level",
  steps: [{ atLevel: 5, dice: `2${die}` }, { atLevel: 11, dice: `3${die}` }, { atLevel: 17, dice: `4${die}` }]
});

/* ── Dragonborn ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const ANCESTORS: Array<[string, string, DamageType]> = [
  ["black", "Black", "acid"], ["blue", "Blue", "lightning"], ["brass", "Brass", "fire"], ["bronze", "Bronze", "lightning"],
  ["copper", "Copper", "acid"], ["gold", "Gold", "fire"], ["green", "Green", "poison"], ["red", "Red", "fire"],
  ["silver", "Silver", "cold"], ["white", "White", "cold"]
];

function breathWeapon(type: DamageType): ActionDefinition[] {
  const base = {
    kind: "area-save" as const, actionType: "action" as const, saveAbility: "dex" as const,
    dcFormula: { base: 8, ability: "con" as const, proficiency: true },
    damage: [{ dice: "1d10", damageType: type, magical: true, scaling: byCharacterLevel("d10") }],
    halfDamageOnSuccess: true, onSuccess: "half" as const, affects: "all" as const,
    resourceCost: { resourceId: "breath-weapon", amount: 1 }, automationSupport: "full" as const
  };
  return [
    { ...base, id: "breath-weapon-cone", name: "Breath Weapon (cone)", range: 15, area: { type: "cone", size: 15 }, targeting: { origin: "self", aimedFromSelf: true, range: 0 } },
    { ...base, id: "breath-weapon-line", name: "Breath Weapon (line)", range: 30, area: { type: "rectangle", size: 30, width: 5 }, targeting: { origin: "self", aimedFromSelf: true, range: 0 } }
  ];
}

const ancestor = ([id, name, type]: [string, string, DamageType]): PickOption => ({
  id, name: `${name} (${type})`,
  grants: [
    {
      key: "breath-weapon",
      feature: runs(trait("dragonborn", "Breath Weapon"), {
        grantedActions: breathWeapon(type),
        notSimulated: "it's an action of its own, not one of the Attack action's attacks."
      }),
      pool: { id: "breath-weapon", size: "{pb}" }
    },
    {
      key: "damage-resistance",
      feature: runs(trait("dragonborn", "Damage Resistance"), { effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } }] })
    }
  ]
});

const DRAGONBORN: SpeciesDefinition = {
  id: "srd:species:dragonborn", name: "Dragonborn", source: source("dragonborn"), edition: "2024",
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  levels: [
    {
      level: 1,
      grants: [{ key: "darkvision", feature: informational(trait("dragonborn", "Darkvision")) }],
      choices: [{ kind: "pick", id: "draconic-ancestry", label: "Draconic Ancestry", count: 1, options: ANCESTORS.map(ancestor) }]
    },
    { level: 5, grants: [{ key: "draconic-flight", feature: reference(trait("dragonborn", "Draconic Flight")) }] }
  ],
  description: "Descended from dragons, with a breath weapon and a resistance from its ancestor."
};

/* ── Dwarf ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const DWARF: SpeciesDefinition = {
  id: "srd:species:dwarf", name: "Dwarf", source: source("dwarf"), edition: "2024",
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 120 },
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("dwarf", "Darkvision")) },
      {
        key: "dwarven-resilience",
        feature: runs(trait("dwarf", "Dwarven Resilience"), {
          effects: [
            { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "poison" } },
            { kind: "save-advantage", against: { conditions: ["poisoned"] } }
          ]
        })
      },
      { key: "dwarven-toughness", feature: informational(trait("dwarf", "Dwarven Toughness")), adjust: { hpBonus: "{charLevel}" } },
      { key: "stonecunning", feature: informational(trait("dwarf", "Stonecunning")) }
    ]
  }],
  description: "Stout and tough, resistant to poison."
};

/* ── Elf ────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const ELVEN_LINEAGES: PickOption[] = [
  {
    id: "drow", name: "Drow", description: "Darkvision 120 ft, Dancing Lights; Faerie Fire at 3rd, Darkness at 5th",
    grants: [
      { key: "drow", feature: runs(trait("elf", "Elven Lineage"), { name: "Elven Lineage: Drow" }), adjust: { senses: { darkvision: 120 } }, spells: [spell("dancing-lights")] },
      leveledSpell("drow", 3, "faerie-fire"),
      leveledSpell("drow", 5, "darkness")
    ]
  },
  {
    id: "high-elf", name: "High Elf", description: "A Wizard cantrip; Detect Magic at 3rd, Misty Step at 5th",
    grants: [
      { key: "high-elf", feature: runs(trait("elf", "Elven Lineage"), { name: "Elven Lineage: High Elf" }) },
      leveledSpell("high-elf", 3, "detect-magic"),
      leveledSpell("high-elf", 5, "misty-step")
    ],
    // Prestidigitation, or another Wizard cantrip in its place.
    choices: [{ kind: "spells", id: "cantrip", what: "cantrips", count: 1, lists: ["wizard"], label: "High Elf: a Wizard cantrip (Prestidigitation, or another)" }]
  },
  {
    id: "wood-elf", name: "Wood Elf", description: "Speed 35 ft, Druidcraft; Longstrider at 3rd, Pass without Trace at 5th",
    grants: [
      { key: "wood-elf", feature: runs(trait("elf", "Elven Lineage"), { name: "Elven Lineage: Wood Elf" }), adjust: { speed: 5 }, spells: [spell("druidcraft")] },
      leveledSpell("wood-elf", 3, "longstrider"),
      leveledSpell("wood-elf", 5, "pass-without-trace")
    ]
  }
];

const ELF: SpeciesDefinition = {
  id: "srd:species:elf", name: "Elf", source: source("elf"), edition: "2024",
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  spellcastingAbilityChoice: "spellcasting-ability",
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("elf", "Darkvision")) },
      { key: "fey-ancestry", feature: runs(trait("elf", "Fey Ancestry"), { effects: [{ kind: "save-advantage", against: { conditions: ["charmed"] } }] }) },
      { key: "trance", feature: informational(trait("elf", "Trance")) }
    ],
    choices: [
      { kind: "pick", id: "elven-lineage", label: "Elven Lineage", count: 1, options: ELVEN_LINEAGES },
      SPELLCASTING_ABILITY,
      { kind: "skills", id: "keen-senses", count: 1, from: ["insight", "perception", "survival"] }
    ]
  }],
  description: "Long-lived and fey-touched, with a lineage's magic."
};

/* ── Gnome ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const GNOME: SpeciesDefinition = {
  id: "srd:species:gnome", name: "Gnome", source: source("gnome"), edition: "2024",
  sizes: ["small"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  spellcastingAbilityChoice: "spellcasting-ability",
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("gnome", "Darkvision")) },
      { key: "gnomish-cunning", feature: runs(trait("gnome", "Gnomish Cunning"), { effects: [{ kind: "save-advantage", abilities: ["int", "wis", "cha"] }] }) }
    ],
    choices: [
      {
        kind: "pick", id: "gnomish-lineage", label: "Gnomish Lineage", count: 1,
        options: [
          {
            id: "forest-gnome", name: "Forest Gnome", description: "Minor Illusion; Speak with Animals free, proficiency-bonus times",
            grants: [{
              key: "forest-gnome", feature: runs(trait("gnome", "Gnomish Lineage"), { name: "Gnomish Lineage: Forest Gnome" }),
              spells: [spell("minor-illusion"), spell("speak-with-animals")], freeCasts: [{ spell: spell("speak-with-animals"), uses: "{pb}" }]
            }]
          },
          {
            id: "rock-gnome", name: "Rock Gnome", description: "Mending and Prestidigitation, and clockwork devices",
            grants: [{
              key: "rock-gnome", feature: runs(trait("gnome", "Gnomish Lineage"), { name: "Gnomish Lineage: Rock Gnome" }),
              spells: [spell("mending"), spell("prestidigitation")]
            }]
          }
        ]
      },
      SPELLCASTING_ABILITY
    ]
  }],
  description: "Small and clever, hard to fool with magic."
};

/* ── Goliath ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const GIANT_POOL = { id: "giant-ancestry", size: "{pb}" };
const GIANT_USE = { resourceId: "giant-ancestry", amount: 1 };
const giant = (id: string, name: string, feature: FeatureGrant["feature"]): PickOption => ({
  id, name, grants: [{ key: "giant-ancestry", feature, pool: GIANT_POOL }]
});
const GIANT_ANCESTRIES: PickOption[] = [
  giant("cloud", "Cloud's Jaunt (Cloud Giant)", runs(trait("goliath", "Giant Ancestry"), {
    name: "Giant Ancestry: Cloud's Jaunt",
    grantedActions: [{
      kind: "reposition", id: "clouds-jaunt", name: "Cloud's Jaunt", actionType: "bonus", range: 30, targeting: { target: "self" },
      resourceCost: { resourceId: "giant-ancestry", amount: 1 }, automationSupport: "full"
    }]
  })),
  giant("fire", "Fire's Burn (Fire Giant)", runs(trait("goliath", "Giant Ancestry"), {
    name: "Giant Ancestry: Fire's Burn",
    effects: [{ kind: "on-hit-option", option: { name: "Fire's Burn", resourceCost: GIANT_USE, riders: [{ kind: "damage", when: "on-hit", components: [{ dice: "1d10", damageType: "fire", magical: true }] }] } }]
  })),
  giant("frost", "Frost's Chill (Frost Giant)", runs(trait("goliath", "Giant Ancestry"), {
    name: "Giant Ancestry: Frost's Chill",
    effects: [{
      kind: "on-hit-option",
      option: {
        name: "Frost's Chill", resourceCost: GIANT_USE,
        riders: [
          { kind: "damage", when: "on-hit", components: [{ dice: "1d6", damageType: "cold", magical: true }] },
          { kind: "condition", when: "on-hit", condition: { custom: "frosts-chill" }, conditionKey: "Frost's Chill", modifiers: { speedPenaltyFt: 10 }, duration: { kind: "until-source-turn", timing: "start" } }
        ]
      }
    }]
  })),
  giant("hill", "Hill's Tumble (Hill Giant)", runs(trait("goliath", "Giant Ancestry"), {
    name: "Giant Ancestry: Hill's Tumble",
    effects: [{ kind: "on-hit-option", option: { name: "Hill's Tumble", resourceCost: GIANT_USE, riders: [{ kind: "condition", when: "on-hit", condition: "prone", duration: { kind: "permanent" } }] } }],
    notSimulated: "the target must be Large or smaller."
  })),
  giant("stone", "Stone's Endurance (Stone Giant)", runs(trait("goliath", "Giant Ancestry"), {
    name: "Giant Ancestry: Stone's Endurance",
    grantedActions: [{
      kind: "activate-feature", id: "stones-endurance", name: "Stone's Endurance", actionType: "reaction", featureId: "",
      reaction: { trigger: { kind: "would-take-damage" }, target: "self", priority: "worthwhile" },
      damageCut: { kind: "reduce", dice: "1d12", abilityModifier: "con" },
      resourceCost: GIANT_USE, automationSupport: "full"
    }]
  })),
  giant("storm", "Storm's Thunder (Storm Giant)", runs(trait("goliath", "Giant Ancestry"), {
    name: "Giant Ancestry: Storm's Thunder",
    grantedActions: [{
      kind: "attack", id: "storms-thunder", name: "Storm's Thunder", actionType: "reaction", attackType: "ranged", ability: "con", range: 60,
      autoHit: true, damage: [{ dice: "1d8", damageType: "thunder", magical: true }],
      reaction: { trigger: { kind: "hit-by-attack" }, target: "trigger-source", priority: "worthwhile" },
      resourceCost: { resourceId: "giant-ancestry", amount: 1 }, automationSupport: "full"
    }],
    notSimulated: "it answers a hit by an attack, not any damage from a creature within 60 feet."
  }))
];

const GOLIATH: SpeciesDefinition = {
  id: "srd:species:goliath", name: "Goliath", source: source("goliath"), edition: "2024",
  sizes: ["medium"], speed: 35, type: "humanoid",
  levels: [
    {
      level: 1,
      grants: [{ key: "powerful-build", feature: informational(trait("goliath", "Powerful Build")) }],
      choices: [{ kind: "pick", id: "giant-ancestry", label: "Giant Ancestry", count: 1, options: GIANT_ANCESTRIES }]
    },
    { level: 5, grants: [{ key: "large-form", feature: reference(trait("goliath", "Large Form")) }] }
  ],
  description: "Descended from giants, tall and strong, with a giant's boon."
};

/* ── Halfling, Human, Orc, Tiefling ─────────────────────────────────────────────────────────────────────────────── */

const HALFLING: SpeciesDefinition = {
  id: "srd:species:halfling", name: "Halfling", source: source("halfling"), edition: "2024",
  sizes: ["small"], speed: 30, type: "humanoid",
  levels: [{
    level: 1,
    grants: [
      { key: "brave", feature: runs(trait("halfling", "Brave"), { effects: [{ kind: "save-advantage", against: { conditions: ["frightened"] } }] }) },
      { key: "halfling-nimbleness", feature: reference(trait("halfling", "Halfling Nimbleness")) },
      {
        key: "luck",
        feature: runs(trait("halfling", "Luck"), {
          effects: [{ kind: "d20-change", rolls: ["attack", "save"], change: "reroll", onNatural1: true }]
        })
      },
      { key: "naturally-stealthy", feature: informational(trait("halfling", "Naturally Stealthy")) }
    ]
  }],
  description: "Small, brave and lucky."
};

const HUMAN: SpeciesDefinition = {
  id: "srd:species:human", name: "Human", source: source("human"), edition: "2024",
  sizes: ["medium", "small"], speed: 30, type: "humanoid",
  levels: [{
    level: 1,
    grants: [{
      key: "resourceful",
      feature: runs(trait("human", "Resourceful"), { effects: [HEROIC_INSPIRATION] }),
      pool: { id: "heroic-inspiration", size: 1 }
    }],
    choices: [
      { kind: "skills", id: "skillful", count: 1, from: "any" },
      { kind: "feat", id: "versatile", categories: ["origin"], label: "Versatile: an origin feat" }
    ]
  }],
  description: "Adaptable: a skill and an origin feat."
};

const ORC: SpeciesDefinition = {
  id: "srd:species:orc", name: "Orc", source: source("orc"), edition: "2024",
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 120 },
  levels: [{
    level: 1,
    grants: [
      {
        key: "adrenaline-rush",
        feature: runs(trait("orc", "Adrenaline Rush"), {
          // Dash, with as many temporary hit points as the proficiency bonus.
          grantedActions: [{
            kind: "utility", id: "adrenaline-rush", name: "Adrenaline Rush", actionType: "bonus", mode: "dash",
            tempHp: [{ dice: "2" }], resourceCost: { resourceId: "adrenaline-rush", amount: 1 }, automationSupport: "full"
          }]
        }),
        pool: { id: "adrenaline-rush", size: "{pb}" },
        scale: [{ path: "grantedActions.0.tempHp.0.dice", value: "{pb}" }]
      },
      { key: "darkvision", feature: informational(trait("orc", "Darkvision")) },
      {
        key: "relentless-endurance",
        feature: runs(trait("orc", "Relentless Endurance"), { effects: [{ kind: "survive-lethal", resourceId: "relentless-endurance" }] }),
        pool: { id: "relentless-endurance", size: 1 }
      }
    ]
  }],
  description: "Strong and relentless, quick to close in."
};

const LEGACIES: Array<{ id: string; name: string; resistance: DamageType; cantrip: string; third: string; fifth: string }> = [
  { id: "abyssal", name: "Abyssal", resistance: "poison", cantrip: "poison-spray", third: "ray-of-sickness", fifth: "hold-person" },
  { id: "chthonic", name: "Chthonic", resistance: "necrotic", cantrip: "chill-touch", third: "false-life", fifth: "ray-of-enfeeblement" },
  { id: "infernal", name: "Infernal", resistance: "fire", cantrip: "fire-bolt", third: "hellish-rebuke", fifth: "darkness" }
];

const TIEFLING: SpeciesDefinition = {
  id: "srd:species:tiefling", name: "Tiefling", source: source("tiefling"), edition: "2024",
  sizes: ["medium", "small"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  spellcastingAbilityChoice: "spellcasting-ability",
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("tiefling", "Darkvision")) },
      { key: "otherworldly-presence", feature: informational(trait("tiefling", "Otherworldly Presence")), spells: [spell("thaumaturgy")] }
    ],
    choices: [
      {
        kind: "pick", id: "fiendish-legacy", label: "Fiendish Legacy", count: 1,
        options: LEGACIES.map((legacy) => ({
          id: legacy.id, name: legacy.name, description: `Resistance to ${legacy.resistance}`,
          grants: [
            {
              key: legacy.id,
              feature: runs(trait("tiefling", "Fiendish Legacy"), {
                name: `Fiendish Legacy: ${legacy.name}`,
                effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: legacy.resistance } }]
              }),
              spells: [spell(legacy.cantrip)]
            },
            leveledSpell(legacy.id, 3, legacy.third),
            leveledSpell(legacy.id, 5, legacy.fifth)
          ]
        }))
      },
      SPELLCASTING_ABILITY
    ]
  }],
  description: "Touched by the Lower Planes, with a fiendish legacy's resistance and magic."
};

export const SRD_2024_SPECIES: SpeciesDefinition[] = [DRAGONBORN, DWARF, ELF, GNOME, GOLIATH, HALFLING, HUMAN, ORC, TIEFLING];
