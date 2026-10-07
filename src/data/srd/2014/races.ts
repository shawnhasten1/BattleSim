import type { PickOption, SpeciesDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../source";
import { informational, runs } from "./authoring";
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

/* ── Human ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const HUMAN: SpeciesDefinition = {
  id: "srd:species:human-2014", name: "Human", edition: "2014", ...raceEntry("human"),
  sizes: ["medium"], speed: 30, type: "humanoid",
  levels: [],
  description: "+1 to every ability score."
};

export const SRD_2014_RACES: SpeciesDefinition[] = [DWARF, HUMAN];
