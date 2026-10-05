import { describe, expect, it } from "vitest";
import {
  backgroundDefinitionSchema,
  classDefinitionSchema,
  featDefinitionSchema,
  speciesDefinitionSchema,
  subclassDefinitionSchema,
  type BackgroundDefinition,
  type ClassDefinition,
  type FeatDefinition,
  type SpeciesDefinition,
  type SubclassDefinition
} from "@/lib/character-builder/catalog";
import { characterBuildSchema, parseCharacterBuild, type CharacterBuild } from "@/lib/character-builder/build-record";

const SRD = { provider: "srd" as const, documentKey: "srd-2024" };
const sneakDice = ["1d6", "1d6", "2d6", "2d6", "3d6", "3d6", "4d6", "4d6", "5d6", "5d6", "6d6", "6d6", "7d6", "7d6", "8d6", "8d6", "9d6", "9d6", "10d6", "10d6"];

/** A hand-written Rogue, the way a catalog entry is authored: every field a class can carry. */
const rogue: ClassDefinition = {
  id: "srd:class:rogue",
  name: "Rogue",
  source: SRD,
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["dex"],
  saves: ["dex", "int"],
  skills: { count: 4, from: ["acrobatics", "athletics", "deception", "insight", "stealth"] },
  weaponProficiency: ["simple", "martial-finesse-or-light"],
  armorTraining: ["light"],
  weaponMastery: Array(20).fill(2),
  subclassLevel: 3,
  subclassLabel: "Rogue Subclass",
  featLevels: [4, 8, 10, 12, 16],
  table: [{ id: "sneak-attack", label: "Sneak Attack", values: sneakDice }],
  levels: [
    {
      level: 1,
      grants: [{
        key: "sneak-attack",
        ref: "srd-2024_rogue_sneak-attack",
        feature: "srd:feature:sneak-attack",
        scale: [{ path: "effects.0.damage.0.dice", value: "{col:sneak-attack}" }]
      }],
      choices: [
        { kind: "skills", id: "skills", count: 4, from: ["acrobatics", "stealth"] },
        { kind: "expertise", id: "expertise", count: 2 },
        { kind: "weapon-mastery", id: "weapon-mastery" }
      ]
    },
    { level: 3, grants: [], choices: [{ kind: "subclass", id: "subclass" }] },
    { level: 4, grants: [], choices: [{ kind: "feat", id: "feat", categories: ["general"] }] },
    { level: 15, grants: [{ key: "slippery-mind", adjust: { saves: ["wis", "cha"] } }] }
  ],
  startingEquipment: [
    { id: "A", label: "Leather armor, two daggers, a shortsword and a shortbow", items: [{ ref: "srd:weapon:dagger", count: 2 }], gold: 8 },
    { id: "B", label: "100 GP", items: [], gold: 100 }
  ],
  suggested: { abilities: ["dex", "con", "wis"], tactics: "skirmisher" }
};

const thief: SubclassDefinition = {
  id: "srd:subclass:thief",
  name: "Thief",
  source: SRD,
  edition: "2024",
  classId: "srd:class:rogue",
  levels: [{ level: 3, grants: [{ key: "second-story-work", adjust: { movementEqualToSpeed: ["climb"] } }] }]
};

const asi: FeatDefinition = {
  id: "srd:feat:ability-score-improvement",
  name: "Ability Score Improvement",
  source: SRD,
  edition: "2024",
  category: "general",
  prerequisite: { level: 4 },
  grants: [],
  choices: [{ kind: "abilities", id: "increase", label: "+2 to one score or +1 to two", points: 2, from: ["str", "dex", "con", "int", "wis", "cha"], maxPerAbility: 2, cap: 20 }],
  repeatable: true
};

const soldier: BackgroundDefinition = {
  id: "srd:background:soldier",
  name: "Soldier",
  source: SRD,
  edition: "2024",
  abilities: ["str", "dex", "con"],
  skills: ["athletics", "intimidation"],
  feat: "srd:feat:savage-attacker"
};

const elf: SpeciesDefinition = {
  id: "srd:species:elf",
  name: "Elf",
  source: SRD,
  edition: "2024",
  sizes: ["medium"],
  speed: 30,
  type: "humanoid",
  senses: { darkvision: 60 },
  levels: [{
    level: 1,
    grants: [{ key: "fey-ancestry", feature: { id: "fey-ancestry", name: "Fey Ancestry", category: "trait", automationSupport: "full", effects: [{ kind: "save-advantage", against: { conditions: ["charmed"] } }] } }],
    choices: [{
      kind: "pick", id: "lineage", label: "Elven Lineage", count: 1,
      options: [{ id: "wood-elf", name: "Wood Elf", grants: [{ key: "wood-elf-speed", adjust: { speed: 5 } }] }]
    }]
  }]
};

const build: CharacterBuild = {
  version: 1,
  edition: "2024",
  abilities: { method: "standard-array", base: { str: 8, dex: 15, con: 13, int: 12, wis: 14, cha: 10 } },
  background: { id: "srd:background:soldier", increases: { dex: 2, con: 1 } },
  species: { id: "srd:species:elf", choices: { lineage: ["wood-elf"] } },
  hp: { method: "average" },
  levels: [
    { classId: "srd:class:rogue", choices: { skills: ["acrobatics", "stealth"], expertise: ["stealth", "acrobatics"], "weapon-mastery": ["dagger", "shortbow"] } },
    { classId: "srd:class:rogue", choices: {} },
    { classId: "srd:class:rogue", choices: { subclass: "srd:subclass:thief" } },
    { classId: "srd:class:rogue", choices: { feat: { feat: "srd:feat:ability-score-improvement", increases: { dex: 2 } } } }
  ],
  equipment: { classOption: "A", applied: true },
  made: { "feat-sneak": { key: "class:srd:class:rogue:sneak-attack", fingerprint: "abc123" } }
};

describe("catalog schemas", () => {
  it("round-trip a hand-written class, subclass, feat, background and species", () => {
    expect(classDefinitionSchema.parse(rogue)).toEqual(rogue);
    expect(subclassDefinitionSchema.parse(thief)).toEqual(thief);
    expect(featDefinitionSchema.parse(asi)).toEqual(asi);
    expect(backgroundDefinitionSchema.parse(soldier)).toEqual(soldier);
    expect(speciesDefinitionSchema.parse(elf)).toEqual(elf);
  });

  it("need every column and progression to cover levels 1 to 20", () => {
    const short = { ...rogue, table: [{ id: "sneak-attack", label: "Sneak Attack", values: sneakDice.slice(0, 19) }] };
    expect(classDefinitionSchema.safeParse(short).success).toBe(false);
    expect(classDefinitionSchema.safeParse({ ...rogue, weaponMastery: [2, 2] }).success).toBe(false);
  });

  it("reject a choice of an unknown kind and a grant without a key", () => {
    const badChoice = { ...rogue, levels: [{ level: 1, grants: [], choices: [{ kind: "telepathy", id: "x" }] }] };
    expect(classDefinitionSchema.safeParse(badChoice).success).toBe(false);
    const badGrant = { ...rogue, levels: [{ level: 1, grants: [{ feature: "srd:feature:rage" }] }] };
    expect(classDefinitionSchema.safeParse(badGrant).success).toBe(false);
  });
});

describe("the build record", () => {
  it("round-trips", () => {
    expect(characterBuildSchema.parse(build)).toEqual(build);
    expect(parseCharacterBuild(JSON.parse(JSON.stringify(build)))).toEqual({ build });
  });

  it("is absent on a hand-built actor, and an invalid one says why", () => {
    expect(parseCharacterBuild(undefined)).toEqual({});
    const noLevels = parseCharacterBuild({ ...build, levels: [] });
    expect(noLevels.build).toBeUndefined();
    expect(noLevels.error).toMatch(/^levels/);
    const tooMany = parseCharacterBuild({ ...build, levels: Array(21).fill(build.levels[0]) });
    expect(tooMany.error).toMatch(/^levels/);
    expect(parseCharacterBuild({ ...build, version: 2 }).error).toMatch(/^version/);
  });
});
