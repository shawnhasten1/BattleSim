import type { ActionDefinition, Ability, DamageType } from "@/engine";
import type { PickOption, SpeciesDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../source";
import { builderGrant, choice, informational, reference, runs, spell } from "./authoring";
import { srd14Race } from "./reference";

/**
 * The 2014 races (SRD 5.1), as the builder's species: each race's own ability increases, size, speed and senses, its
 * traits, and its subrace as a choice whose option carries the subrace's increases and traits. The increases apply when
 * the character's come from its race (\`increasesFrom\`). Where a trait's rules match the 2024 species' (Dwarven
 * Resilience), it runs the same way.
 */

const trait = (race: string, name: string) => ({ race, trait: name });
const raceEntry = (key: string) => {
  const race = srd14Race(key);
  return { source: srd51Source(race.key), abilities: race.abilities, ...(race.abilityChoice ? { abilityChoice: race.abilityChoice } : {}) };
};

/** A subrace as its race's choice: its increases, and its traits as the option's grants. */
function subrace(key: string, grants: PickOption["grants"]): PickOption {
  const race = srd14Race(key);
  return { id: key.replace(/^srd_/, ""), name: race.name, description: race.traits.map((entry) => entry.name).join(", "), abilities: race.abilities, grants };
}

/* ── Dwarf ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const DWARF: SpeciesDefinition = {
  id: "srd:species:dwarf-2014", name: "Dwarf", edition: "2014", ...raceEntry("dwarf"),
  sizes: ["medium"], speed: 25, type: "humanoid", senses: { darkvision: 60 },
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
      // Proficiency with the battleaxe, handaxe, light hammer and warhammer: the builder doesn't track weapon proficiency.
      { key: "dwarven-combat-training", feature: informational(trait("dwarf", "Dwarven Combat Training")) },
      { key: "tool-proficiency", feature: informational(trait("dwarf", "Tool Proficiency")) },
      { key: "stonecunning", feature: informational(trait("dwarf", "Stonecunning")) }
    ],
    choices: [{
      kind: "pick", id: "subrace", label: "Subrace", count: 1,
      options: [subrace("srd_hill-dwarf", [
        // +1 hit point a level: the builder adds it.
        { key: "dwarven-toughness", feature: runs(trait("hill-dwarf", "Dwarven Toughness")), adjust: { hpBonus: "{charLevel}" } }
      ])]
    }]
  }],
  description: "Bold and hardy, resistant to poison; a Hill Dwarf is tougher still."
};

/* ── Dragonborn ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Each dragon: its damage type, its breath's shape and the save against it (SRD 5.1's Draconic Ancestry table). */
const DRAGONS: Array<[string, string, DamageType, "line" | "cone", Ability]> = [
  ["black", "Black", "acid", "line", "dex"], ["blue", "Blue", "lightning", "line", "dex"], ["brass", "Brass", "fire", "line", "dex"],
  ["bronze", "Bronze", "lightning", "line", "dex"], ["copper", "Copper", "acid", "line", "dex"], ["gold", "Gold", "fire", "cone", "dex"],
  ["green", "Green", "poison", "cone", "con"], ["red", "Red", "fire", "cone", "dex"], ["silver", "Silver", "cold", "cone", "con"],
  ["white", "White", "cold", "cone", "con"]
];

/** The 2014 breath: an action of its own (not one of the Attack action's attacks), 2d6 rising at 6th, 11th and 16th. */
function breathWeapon(type: DamageType, shape: "line" | "cone", save: Ability): ActionDefinition {
  return {
    kind: "area-save", id: "breath-weapon", name: "Breath Weapon", actionType: "action", saveAbility: save,
    dcFormula: { base: 8, ability: "con", proficiency: true },
    damage: [{
      dice: "2d6", damageType: type, magical: true,
      scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 6, dice: "3d6" }, { atLevel: 11, dice: "4d6" }, { atLevel: 16, dice: "5d6" }] }
    }],
    halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
    ...(shape === "line"
      ? { range: 30, area: { type: "rectangle", size: 30, width: 5 } }
      : { range: 15, area: { type: "cone", size: 15 } }),
    targeting: { origin: "self", aimedFromSelf: true, range: 0 },
    resourceCost: { resourceId: "breath-weapon", amount: 1 }, automationSupport: "full"
  } as ActionDefinition;
}

const DRAGONBORN: SpeciesDefinition = {
  id: "srd:species:dragonborn-2014", name: "Dragonborn", edition: "2014", ...raceEntry("dragonborn"),
  sizes: ["medium"], speed: 30, type: "humanoid",
  levels: [{
    level: 1,
    grants: [builderGrant("draconic-ancestry-table", "dragonborn:Draconic Ancestry table")],
    choices: [choice({
      kind: "pick", id: "draconic-ancestry", label: "Draconic Ancestry", count: 1,
      options: DRAGONS.map(([id, name, type, shape, save]): PickOption => ({
        id, name: `${name} (${type})`, description: `${shape === "line" ? "5 by 30 ft line" : "15 ft cone"}, ${save === "dex" ? "Dexterity" : "Constitution"} save`,
        grants: [
          // Once between rests: once a fight.
          { key: "breath-weapon", feature: runs(trait("dragonborn", "Breath Weapon"), { grantedActions: [breathWeapon(type, shape, save)] }), pool: { id: "breath-weapon", size: 1 } },
          {
            key: "damage-resistance",
            feature: runs(trait("dragonborn", "Damage Resistance"), { effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } }] })
          }
        ]
      }))
    }, "dragonborn:Draconic Ancestry")]
  }],
  description: "Draconic ancestry: a breath weapon and a resistance; +2 Strength, +1 Charisma."
};

/* ── Elf ────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const FEY_ANCESTRY = (race: string) => runs(trait(race, "Fey Ancestry"), { effects: [{ kind: "save-advantage", against: { conditions: ["charmed"] } }] });

const ELF: SpeciesDefinition = {
  id: "srd:species:elf-2014", name: "Elf", edition: "2014", ...raceEntry("elf"),
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  skills: ["perception"],
  // The High Elf's cantrip: Intelligence.
  spellcastingAbility: "int",
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("elf", "Darkvision")) },
      builderGrant("keen-senses", "elf:Keen Senses"),
      { key: "fey-ancestry", feature: FEY_ANCESTRY("elf") },
      { key: "trance", feature: informational(trait("elf", "Trance")) }
    ],
    choices: [{
      kind: "pick", id: "subrace", label: "Subrace", count: 1,
      options: [{
        ...subrace("srd_high-elf", [
          // Proficiency with the longsword, shortsword, shortbow and longbow: the builder doesn't track weapon proficiency.
          { key: "elf-weapon-training", feature: informational(trait("high-elf", "Elf Weapon Training")) }
        ]),
        choices: [choice({ kind: "spells", id: "cantrip", what: "cantrips", count: 1, lists: ["wizard-2014"], label: "High Elf: a Wizard cantrip" }, "high-elf:Cantrip")]
      }]
    }]
  }],
  description: "Graceful and fey, keen-eyed, never charmed easily; a High Elf knows a wizard's cantrip."
};

/* ── Gnome ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const GNOME: SpeciesDefinition = {
  id: "srd:species:gnome-2014", name: "Gnome", edition: "2014", ...raceEntry("gnome"),
  sizes: ["small"], speed: 25, type: "humanoid", senses: { darkvision: 60 },
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("gnome", "Darkvision")) },
      {
        key: "gnome-cunning",
        feature: runs(trait("gnome", "Gnome Cunning"), { effects: [{ kind: "save-advantage", abilities: ["int", "wis", "cha"], against: { source: "magical" } }] })
      }
    ],
    choices: [{
      kind: "pick", id: "subrace", label: "Subrace", count: 1,
      options: [subrace("srd_rock-gnome", [
        { key: "artificers-lore", feature: informational(trait("rock-gnome", "Artificer's Lore")) },
        { key: "tinker", feature: informational(trait("rock-gnome", "Tinker")) }
      ])]
    }]
  }],
  description: "Small and clever, hard to fool with magic; a Rock Gnome tinkers."
};

/* ── Half-Elf, Half-Orc ─────────────────────────────────────────────────────────────────────────────────────────── */

const HALF_ELF: SpeciesDefinition = {
  id: "srd:species:half-elf-2014", name: "Half-Elf", edition: "2014", ...raceEntry("half-elf"),
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("half-elf", "Darkvision")) },
      { key: "fey-ancestry", feature: FEY_ANCESTRY("half-elf") }
    ],
    choices: [choice({ kind: "skills", id: "skill-versatility", count: 2, from: "any" }, "half-elf:Skill Versatility")]
  }],
  description: "+2 Charisma and +1 to two others, two skills, and an elf's Fey Ancestry."
};

const HALF_ORC: SpeciesDefinition = {
  id: "srd:species:half-orc-2014", name: "Half-Orc", edition: "2014", ...raceEntry("half-orc"),
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  skills: ["intimidation"],
  levels: [{
    level: 1,
    grants: [
      { key: "darkvision", feature: informational(trait("half-orc", "Darkvision")) },
      builderGrant("menacing", "half-orc:Menacing"),
      {
        key: "relentless-endurance",
        feature: runs(trait("half-orc", "Relentless Endurance"), { effects: [{ kind: "survive-lethal", resourceId: "relentless-endurance" }] }),
        pool: { id: "relentless-endurance", size: 1 }
      },
      // An extra weapon die on a melee critical hit: the engine has no extra critical dice yet (Phase 10).
      { key: "savage-attacks", feature: reference(trait("half-orc", "Savage Attacks")) }
    ]
  }],
  description: "Strong and relentless: it drops to 1 hit point instead of 0 once a day."
};

/* ── Halfling ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const HALFLING: SpeciesDefinition = {
  id: "srd:species:halfling-2014", name: "Halfling", edition: "2014", ...raceEntry("halfling"),
  sizes: ["small"], speed: 25, type: "humanoid",
  levels: [{
    level: 1,
    grants: [
      { key: "lucky", feature: runs(trait("halfling", "Lucky"), { effects: [{ kind: "d20-change", rolls: ["attack", "save"], change: "reroll", onNatural1: true }] }) },
      { key: "brave", feature: runs(trait("halfling", "Brave"), { effects: [{ kind: "save-advantage", against: { conditions: ["frightened"] } }] }) },
      // Every creature here can move through another's space: nothing more to run.
      { key: "halfling-nimbleness", feature: runs(trait("halfling", "Halfling Nimbleness")) }
    ],
    choices: [{
      kind: "pick", id: "subrace", label: "Subrace", count: 1,
      options: [subrace("srd_lightfoot", [{ key: "naturally-stealthy", feature: informational(trait("lightfoot", "Naturally Stealthy")) }])]
    }]
  }],
  description: "Small, brave and lucky; a Lightfoot hides behind bigger folk."
};

/* ── Human ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const HUMAN: SpeciesDefinition = {
  id: "srd:species:human-2014", name: "Human", edition: "2014", ...raceEntry("human"),
  sizes: ["medium"], speed: 30, type: "humanoid",
  levels: [],
  description: "+1 to every ability score."
};

/* ── Tiefling ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const TIEFLING: SpeciesDefinition = {
  id: "srd:species:tiefling-2014", name: "Tiefling", edition: "2014", ...raceEntry("tiefling"),
  sizes: ["medium"], speed: 30, type: "humanoid", senses: { darkvision: 60 },
  spellcastingAbility: "cha",
  levels: [
    {
      level: 1,
      grants: [
        { key: "darkvision", feature: informational(trait("tiefling", "Darkvision")) },
        {
          key: "hellish-resistance",
          feature: runs(trait("tiefling", "Hellish Resistance"), { effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "fire" } }] })
        },
        { key: "infernal-legacy", feature: runs(trait("tiefling", "Infernal Legacy")), spells: [spell("thaumaturgy")] }
      ]
    },
    // Each once a day, by the trait alone (never with a slot): Hellish Rebuke as a 2nd-level spell, then Darkness.
    { level: 3, grants: [{ key: "infernal-legacy-3", freeCasts: [{ spell: spell("hellish-rebuke"), uses: 1, castAt: 2, label: "Infernal Legacy" }] }] },
    { level: 5, grants: [{ key: "infernal-legacy-5", freeCasts: [{ spell: spell("darkness"), uses: 1, label: "Infernal Legacy" }] }] }
  ],
  description: "Infernal heritage: resistance to fire, Thaumaturgy, then Hellish Rebuke and Darkness once a day."
};

export const SRD_2014_RACES: SpeciesDefinition[] = [DRAGONBORN, DWARF, ELF, GNOME, HALF_ELF, HALF_ORC, HALFLING, HUMAN, TIEFLING];
